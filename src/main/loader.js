// Port of WebLoader.swift: one hidden, non-persistent Chromium page, strictly paced.
// One page or table expansion at a time, at least five seconds apart, at most 300 per run.
'use strict';
const { BrowserWindow, session } = require('electron');

class SourceError extends Error {
  constructor(message, { stopsRun = false, retryAt = null } = {}) {
    super(message);
    this.name = 'SourceError';
    this.stopsRun = stopsRun;
    this.retryAt = retryAt;
  }
}
class CancellationError extends Error {
  constructor() { super('Zaustavljeno.'); this.name = 'CancellationError'; }
}

const MAX_PAGES = 300;
const GAP_MS = 5000;
// Only Flashscore's own hosts can signal a block; ad and consent scripts often answer 403.
const OWN_HOST = /(^|\.)(flashscore\.com|flashscore\.ninja|livesportmedia\.eu)$/i;
// Without a working connection every following page would fail the same way.
const OFFLINE = new Set(['ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED',
  'ERR_ADDRESS_UNREACHABLE', 'ERR_NETWORK_ACCESS_DENIED', 'ERR_PROXY_CONNECTION_FAILED']);

function retryDate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Date.now() + Math.max(0, parseFloat(text)) * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}
const clock = ms => new Date(ms).toLocaleString('sr-Latn-RS', { timeZone: 'Europe/Belgrade', dateStyle: 'short', timeStyle: 'short' });

class WebLoader {
  constructor() {
    this.win = null;
    this.pages = 0;
    this.lastNavigation = null;
    this.cooldownUntil = null;
    this.onPage = null;
    this.cancelled = false;
    this.blocked = null;
    this.waiters = new Set();
  }

  begin() {
    this.stop();
    this.pages = 0;
    this.cancelled = false;
    this.blocked = null;
    // A partition without the "persist:" prefix lives only in memory: no cookies survive a run.
    const ses = session.fromPartition(`fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.webRequest.onCompleted(details => {
      if (details.statusCode !== 403 && details.statusCode !== 429) return;
      let host = '';
      try { host = new URL(details.url).hostname; } catch { return; }
      if (!OWN_HOST.test(host)) return;
      const headers = details.responseHeaders || {};
      const retryKey = Object.keys(headers).find(k => k.toLowerCase() === 'retry-after');
      this.blocked = { status: details.statusCode, retry: retryKey ? [].concat(headers[retryKey])[0] : null, mainFrame: details.resourceType === 'mainFrame' };
    });
    this.win = new BrowserWindow({
      show: false, width: 1200, height: 900,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
    });
    this.win.webContents.setAudioMuted(true);
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  stop() {
    this.cancelled = true;
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(new CancellationError()); }
    this.waiters.clear();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  guard() {
    if (this.cancelled || !this.win || this.win.isDestroyed()) throw new CancellationError();
  }

  /** Resolves after ms, or rejects at once when the loader stops. */
  sleep(ms) {
    return this.race(null, ms);
  }

  /** Races a promise against a timeout and against stop(). */
  race(promise, ms, timeoutMessage) {
    return new Promise((resolve, reject) => {
      if (this.cancelled) { reject(new CancellationError()); return; }
      const waiter = { timer: null, reject };
      const done = () => { clearTimeout(waiter.timer); this.waiters.delete(waiter); };
      waiter.timer = setTimeout(() => {
        done();
        if (!promise) { resolve(); return; }
        try { this.win?.webContents.stop(); } catch { /* window already gone */ }
        reject(new SourceError(timeoutMessage));
      }, ms);
      this.waiters.add(waiter);
      if (promise) promise.then(v => { done(); resolve(v); }, e => { done(); reject(e); });
    });
  }

  async pace() {
    if (this.lastNavigation) {
      const delay = GAP_MS - (Date.now() - this.lastNavigation);
      if (delay > 0) await this.sleep(delay);
    }
    if (this.cancelled) throw new CancellationError();
  }

  async throttleExpansion() {
    if (this.pages >= MAX_PAGES) throw new SourceError('Dostignuto je ograničenje od 300 učitavanja.', { stopsRun: true });
    await this.pace();
    this.guard();
    this.pages += 1; this.lastNavigation = Date.now(); this.onPage?.(this.pages);
  }

  async evaluate(script) {
    this.guard();
    return this.race(this.win.webContents.executeJavaScript(script), 20000, 'Flashscore stranica ne odgovara.');
  }

  async load(url) {
    let parsed = null;
    try { parsed = new URL(url); } catch { /* handled below */ }
    if (!parsed || parsed.protocol !== 'https:' || !['www.flashscore.com', 'flashscore.com'].includes(parsed.hostname)) {
      throw new SourceError('Dozvoljene su samo Flashscore stranice.');
    }
    if (this.cooldownUntil && this.cooldownUntil > Date.now()) {
      throw new SourceError(`Izvor traži pauzu do ${clock(this.cooldownUntil)}.`, { stopsRun: true, retryAt: this.cooldownUntil });
    }
    if (this.pages >= MAX_PAGES) throw new SourceError('Dostignuto je ograničenje od 300 stranica. Sačuvan je delimičan izveštaj.', { stopsRun: true });
    await this.pace();
    this.guard();
    this.pages += 1; this.lastNavigation = Date.now(); this.onPage?.(this.pages);
    this.blocked = null;
    const navigation = this.win.webContents.loadURL(parsed.toString()).catch(error => {
      const code = String(error?.code || '');
      // A navigation superseded by the page's own redirect still leaves a loaded page.
      if (code === 'ERR_ABORTED') return;
      if (this.cancelled) throw new CancellationError();
      if (OFFLINE.has(code)) throw new SourceError('Nema veze sa Flashscore-om. Proveri internet konekciju i pokušaj ponovo.', { stopsRun: true });
      throw new SourceError(`Flashscore se nije učitao (${code || 'mrežna greška'}).`);
    });
    await this.race(navigation, 35000, 'Flashscore se nije učitao na vreme.');
    await this.checkBlock();
  }

  async waitFor(condition, seconds = 18) {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      await this.checkBlock();
      if (await this.evaluate(condition) === true) return;
      await this.sleep(500);
    }
    throw new SourceError('Tabela nije dostupna ili je Flashscore promenio prikaz. Nisu pretpostavljeni prazni rezultati.');
  }

  /** Waits until a counting expression stops growing, so a table still rendering is never read short. */
  async settle(expression, seconds = 6) {
    let last = -1;
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      const value = await this.evaluate(expression);
      const current = Number.isInteger(value) ? value : -1;
      if (current >= 0 && current === last) return;
      last = current;
      await this.sleep(600);
    }
  }

  async checkBlock() {
    const raw = await this.evaluate("JSON.stringify({title: document.title, text: (document.body?.innerText || '').slice(0, 5000)})");
    let data = {};
    try { data = JSON.parse(raw); } catch { /* treated as an empty page */ }
    const title = String(data.title || '').toLowerCase();
    const text = String(data.text || '').toLowerCase();
    const response = this.blocked;
    const challenged = title.includes('just a moment') || text.includes('verify you are human') || text.includes('access denied') ||
      text.includes('unusual traffic') || text.includes('complete the captcha');
    if (!response && !challenged) return;
    const retry = retryDate(response?.retry) ?? Date.now() + 3600e3;
    this.cooldownUntil = retry;
    try { this.win?.webContents.stop(); } catch { /* window already gone */ }
    const message = response?.mainFrame
      ? `Flashscore je vratio HTTP ${response.status}. Preuzimanje je zaustavljeno.`
      : 'Flashscore je ograničio pristup. Preuzimanje je zaustavljeno; pokušaj kasnije.';
    throw new SourceError(message, { stopsRun: true, retryAt: retry });
  }
}

module.exports = { WebLoader, SourceError, CancellationError, retryDate, MAX_PAGES };
