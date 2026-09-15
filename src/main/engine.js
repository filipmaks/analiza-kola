// Port of AppModel.swift. Owns all state; the window only renders snapshots and sends intents.
'use strict';
const C = require('../core/core.js');
const { WebLoader, SourceError, CancellationError } = require('./loader.js');
const { FlashscoreSource } = require('./source.js');
const { OpenAIService } = require('./openai.js');

const stopsRun = error => error instanceof CancellationError || (error instanceof SourceError && error.stopsRun);
const message = error => (error && error.message) || String(error);

class Engine {
  constructor({ store, secrets, adapterPath, onChange }) {
    this.store = store;
    this.secrets = secrets;
    this.onChange = onChange;
    this.loader = new WebLoader();
    this.ai = new OpenAIService();
    this.source = new FlashscoreSource(this.loader, store, adapterPath);
    this.source.progress = text => { this.state.progress = text; this.changed(); };
    this.cancelRequested = false;
    this.reportRevision = 0;
    this.state = {
      preferences: C.defaultPreferences(), report: null, history: [], isRunning: false,
      progress: 'Spremno za novi pregled', errorMessage: null, keyStatus: '', hasKey: false, checkingKey: false,
      todayScans: [], isScanningToday: false, pendingNewLeagues: [], didScanToday: false, scanSummary: '',
      availableModels: [], customLeagues: [], encryptionAvailable: true
    };
    try {
      this.state.preferences = C.normalizePreferences(store.read('preferences'));
      this.state.customLeagues = store.read('custom-leagues') || [];
      this.state.history = store.reports();
      this.state.report = this.state.history[0] || null;
      this.loader.cooldownUntil = store.read('source-cooldown');
      this.state.encryptionAvailable = secrets.available();
      this.state.hasKey = !!this.readKey();
      // A report left "U toku" by a crash or forced quit is resumable, not running.
      for (const report of this.state.history) {
        if (report.state === 'U toku') { report.state = 'Zaustavljen'; store.write(report, `report:${report.id}`, 'report'); }
      }
    } catch (error) {
      this.state.errorMessage = message(error);
    }
  }

  get allLeagues() { return [...C.CATALOG, ...this.state.customLeagues]; }

  readKey() {
    try { return this.secrets.read(); } catch (error) { this.state.keyStatus = message(error); return null; }
  }

  changed(reportChanged = false) {
    if (reportChanged) this.reportRevision += 1;
    this.onChange?.();
  }

  snapshot(includeReport) {
    const s = this.state;
    const now = Date.now();
    return {
      preferences: s.preferences, allLeagues: this.allLeagues, isRunning: s.isRunning, progress: s.progress,
      errorMessage: s.errorMessage, keyStatus: s.keyStatus, hasKey: s.hasKey, checkingKey: s.checkingKey,
      isScanningToday: s.isScanningToday, pendingNewLeagues: s.pendingNewLeagues, didScanToday: s.didScanToday,
      scanSummary: s.scanSummary, availableModels: s.availableModels, encryptionAvailable: s.encryptionAvailable,
      todayScans: s.todayScans.map(scan => ({ league: scan.league, isKnown: scan.isKnown, total: scan.matches.length, upcoming: C.upcoming(scan, now).length })),
      history: s.history.map(r => ({ id: r.id, createdAt: r.createdAt, state: r.state, matchCount: r.matches.length, leagueCount: r.leagueIDs.length })),
      reportRevision: this.reportRevision,
      reportProgress: s.report ? { id: s.report.id, completed: s.report.completedIDs.length, queued: s.report.queue.length, pages: s.report.pageCount } : null,
      report: includeReport ? s.report : undefined
    };
  }

  // -- Preferences -----------------------------------------------------------

  savePreferences(patch = {}) {
    this.state.preferences = C.normalizePreferences(Object.assign({}, this.state.preferences, patch));
    try { this.store.write(this.state.preferences, 'preferences', 'preferences'); }
    catch (error) { this.state.errorMessage = `Podešavanja nisu sačuvana: ${message(error)}`; }
    this.changed();
  }
  dismissError() { this.state.errorMessage = null; this.changed(); }

  // -- Today scan --------------------------------------------------------------

  async scanToday() {
    const s = this.state;
    if (s.isRunning || s.isScanningToday) return;
    s.isScanningToday = true; s.errorMessage = null; s.scanSummary = '';
    this.changed();
    this.loader.begin();
    try {
      const now = Date.now();
      const scans = await this.source.todayLeagues(this.allLeagues, now);
      s.todayScans = scans;
      s.didScanToday = true;
      s.pendingNewLeagues = scans.filter(x => !x.isKnown && C.upcoming(x, now).length > 0).map(x => x.league);
      // The scan only ever adds: a user's own league choice is never silently dropped.
      const merged = C.mergedSelection(s.preferences.leagueIDs, scans, now);
      this.savePreferences({ leagueIDs: merged.selection });
      const upcomingCount = scans.reduce((n, x) => n + C.upcoming(x, now).length, 0);
      if (upcomingCount === 0) {
        s.scanSummary = 'Danas nema više zakazanih utakmica u dostupnom pregledu. Tvoj izbor liga je nepromenjen.';
      } else {
        s.scanSummary = `Pronađeno ${upcomingCount} predstojećih utakmica u ${scans.filter(x => C.upcoming(x, now).length > 0).length} liga.`;
        if (merged.added.length) {
          const names = this.allLeagues.filter(l => merged.added.includes(l.id)).map(l => l.name).sort();
          s.scanSummary += ` Dodato u izbor: ${names.join(', ')}.`;
        }
      }
    } catch (error) {
      if (!(error instanceof CancellationError)) s.errorMessage = `Skeniranje današnjih liga nije uspelo: ${message(error)}`;
      if (this.loader.cooldownUntil) this.store.write(this.loader.cooldownUntil, 'source-cooldown', 'source');
    } finally {
      this.loader.stop();
      s.isScanningToday = false;
      this.changed();
    }
  }

  acceptNewLeagues() {
    const s = this.state;
    const known = new Set(this.allLeagues.map(l => l.id));
    const additions = s.pendingNewLeagues.filter(l => !known.has(l.id));
    s.customLeagues = [...s.customLeagues, ...additions];
    try { this.store.write(s.customLeagues, 'custom-leagues', 'preferences'); } catch (error) { s.errorMessage = message(error); }
    const added = new Set(additions.map(l => l.id));
    s.todayScans = s.todayScans.map(scan => added.has(scan.league.id) ? Object.assign({}, scan, { isKnown: true }) : scan);
    s.pendingNewLeagues = [];
    this.savePreferences({ leagueIDs: [...s.preferences.leagueIDs, ...added] });
  }

  rejectNewLeagues() {
    const rejected = new Set(this.state.pendingNewLeagues.map(l => l.id));
    this.state.todayScans = this.state.todayScans.filter(scan => !rejected.has(scan.league.id));
    this.state.pendingNewLeagues = [];
    this.changed();
  }

  /** Narrows the selection to today's leagues. Only from an explicit button. */
  useOnlyTodayLeagues() {
    const now = Date.now();
    const playing = [...new Set(this.state.todayScans.filter(x => C.upcoming(x, now).length > 0).map(x => x.league.id))];
    if (!playing.length) return;
    this.state.scanSummary = `Izbor je sužen na ${playing.length} liga koje danas igraju.`;
    this.savePreferences({ leagueIDs: playing });
  }

  // -- OpenAI key and model ------------------------------------------------------

  async saveKey(value) {
    const s = this.state;
    s.checkingKey = true; this.changed();
    try {
      const clean = String(value || '').trim();
      this.secrets.save(clean);
      s.hasKey = !!clean;
      if (clean) {
        await this.ai.verifyKey(clean, s.preferences.aiModel);
        s.keyStatus = `Ključ je sačuvan i šifrovan na ovom računaru; model ${s.preferences.aiModel} je dostupan.`;
        await this.loadModels();
      } else {
        s.availableModels = [];
        s.keyStatus = 'Ključ je uklonjen. Lokalna analiza ostaje dostupna.';
      }
    } catch (error) {
      s.keyStatus = message(error);
    } finally {
      s.checkingKey = false; this.changed();
    }
  }

  async loadModels() {
    const key = this.readKey();
    if (!key) return;
    try {
      const models = await this.ai.availableModels(key);
      if (models.length) { this.state.availableModels = models; this.changed(); }
    } catch { /* The field stays editable by hand. */ }
  }

  selectModel(model) {
    const clean = String(model || '').trim();
    if (!clean) return;
    this.state.keyStatus = `Model je postavljen na ${clean}.`;
    this.savePreferences({ aiModel: clean });
  }

  // -- Reports -------------------------------------------------------------------

  start() {
    const s = this.state;
    // The scan and the report share one page loader; one must finish before the other starts.
    if (s.isRunning || s.isScanningToday) return;
    if (!s.preferences.leagueIDs.length) {
      s.errorMessage = 'Nijedna liga nije izabrana. Otvori Podešavanja → Lige i izaberi bar jednu.';
      this.changed();
      return;
    }
    const chosen = new Set(s.preferences.leagueIDs);
    s.report = C.makeReport({ now: Date.now(), leagueIDs: this.allLeagues.filter(l => chosen.has(l.id)).map(l => l.id), threshold: s.preferences.threshold, aiBudget: s.preferences.aiBudget });
    this.launch();
  }

  resume(id) {
    if (this.state.isRunning || this.state.isScanningToday) return;
    const previous = this.state.history.find(r => r.id === id) || (this.state.report?.id === id ? this.state.report : null);
    if (!previous) return;
    // Preserve original time window, budget and completed work across a manual continuation.
    this.state.report = previous;
    this.launch();
  }

  launch() {
    const s = this.state;
    s.isRunning = true; s.errorMessage = null; s.report.state = 'U toku';
    this.cancelRequested = false;
    try { this.persist(); } catch (error) { s.errorMessage = message(error); s.isRunning = false; this.changed(); return; }
    this.changed(true);
    this.run().catch(error => { s.errorMessage = message(error); s.isRunning = false; this.changed(true); });
  }

  cancel() {
    if (!this.state.isRunning) return;
    this.cancelRequested = true;
    this.loader.stop();
    if (this.state.report) this.state.report.state = 'Zaustavljen';
    try { this.persist(); } catch (error) { this.state.errorMessage = message(error); }
    this.state.progress = 'Zaustavljeno — obrađeni podaci su sačuvani';
    this.changed(true);
  }

  persist() {
    const report = this.state.report;
    if (!report) return;
    this.store.write(report, `report:${report.id}`, 'report');
    this.state.history = this.store.reports();
  }

  checkCancelled() { if (this.cancelRequested) throw new CancellationError(); }

  note(text) { this.state.report.notes.push(text); }

  async run() {
    const s = this.state;
    const report = s.report;
    this.loader.begin();
    const startingPages = report.pageCount || 0;
    this.loader.onPage = pages => { report.pageCount = startingPages + pages; this.changed(); };
    try {
      for (const id of report.leagueIDs) {
        if (report.discoveredLeagueIDs.includes(id)) continue;
        this.checkCancelled();
        const league = this.allLeagues.find(l => l.id === id);
        if (!league) continue;
        try {
          const fixtures = await this.source.fixtures(league, report.createdAt);
          if (this.source.lastFixtureWarning) this.note(this.source.lastFixtureWarning);
          const seen = new Set(report.queue.map(m => m.id));
          const selected = fixtures.filter(m => C.includes(report, m) && !seen.has(m.id) && seen.add(m.id));
          report.queue.push(...selected);
          report.queue.sort((a, b) => a.kickoff - b.kickoff);
          report.discoveredLeagueIDs.push(id);
          if (!selected.length) this.note(`${league.name}: nema zakazanih utakmica u izabranom periodu.`);
          this.persist(); this.changed(true);
        } catch (error) {
          if (stopsRun(error)) throw error;
          this.note(`${league.name}: ${message(error)}`); this.persist(); this.changed(true);
        }
      }
      for (const candidate of [...report.queue]) {
        if (report.completedIDs.includes(candidate.id)) continue;
        this.checkCancelled();
        if (!(candidate.kickoff > Date.now())) {
          report.completedIDs.push(candidate.id);
          this.note(`${candidate.home.name} – ${candidate.away.name}: termin je prošao pre obrade; preskočeno.`);
          this.persist(); this.changed(true);
          continue;
        }
        try {
          const fixture = await this.source.detail(candidate);
          if (!C.includes(report, fixture)) {
            report.completedIDs.push(candidate.id);
            this.note(`${candidate.home.name} – ${candidate.away.name}: termin ili status se promenio.`);
            this.persist(); this.changed(true);
            continue;
          }
          const raw = await this.source.histories(fixture);
          const overall = await this.source.enriched(raw.overall);
          const venue = await this.source.enriched(raw.venue);
          const homeForm = await this.source.enriched(raw.homeForm);
          const awayForm = await this.source.enriched(raw.awayForm);
          const analysis = C.analyze({ fixture, overall: overall.matches, venue: venue.matches, homeForm: homeForm.matches, awayForm: awayForm.matches, threshold: report.threshold, now: report.createdAt });
          const extra = [...new Set([...raw.warnings, ...overall.warnings, ...venue.warnings, ...homeForm.warnings, ...awayForm.warnings])].sort();
          analysis.notes.push(...extra);
          report.matches.push(analysis);
          report.completedIDs.push(fixture.id);
          this.persist(); this.changed(true);
        } catch (error) {
          if (stopsRun(error)) throw error;
          // Left incomplete on purpose: "Nastavi" retries it, and the report stays partial.
          this.note(`${candidate.home.name} – ${candidate.away.name}: ${message(error)}`);
          this.persist(); this.changed(true);
        }
      }
      this.loader.stop();
      this.checkCancelled();
      await this.summarize(report);
      const complete = report.discoveredLeagueIDs.length === report.leagueIDs.length && report.queue.every(m => report.completedIDs.includes(m.id));
      report.state = complete ? 'Završen' : 'Delimičan';
      s.progress = complete ? 'Izveštaj je spreman' : 'Delimičan izveštaj je sačuvan';
      this.persist();
    } catch (error) {
      const cancelled = error instanceof CancellationError || this.cancelRequested;
      report.state = cancelled ? 'Zaustavljen' : 'Delimičan';
      if (!cancelled) { this.note(message(error)); s.errorMessage = message(error); }
      if (this.loader.cooldownUntil) {
        try { this.store.write(this.loader.cooldownUntil, 'source-cooldown', 'source'); } catch { /* best effort */ }
      }
      try { this.persist(); } catch (e) { s.errorMessage = `Čuvanje izveštaja nije uspelo: ${message(e)}`; }
      s.progress = cancelled ? 'Zaustavljeno — obrađeni podaci su sačuvani' : 'Obrađeni deo izveštaja je sačuvan';
    } finally {
      this.loader.stop();
      this.loader.onPage = null;
      s.isRunning = false;
      this.changed(true);
    }
  }

  async summarize(report) {
    const key = this.readKey();
    if (!key) return;
    const model = this.state.preferences.aiModel;
    const eligible = report.matches.filter(m => C.highlighted(m).length > 0 && !m.summary && !report.aiAttemptedIDs.includes(m.id));
    for (let i = 0; i < eligible.length; i += 5) {
      this.checkCancelled();
      const batch = eligible.slice(i, i + 5);
      const cached = this.store.read(this.ai.cacheKey(batch, model));
      if (cached) { this.apply(report, cached); continue; }
      if (!(report.spent + report.reserved < report.aiBudget)) break;
      this.state.progress = 'Pišem kratka obrazloženja'; this.changed();
      try {
        const prepared = await this.ai.prepare(batch, key, model);
        if (!C.AIBudget.permits(report.aiBudget, report.spent, report.reserved, prepared.reservation)) {
          this.note('AI budžet je sačuvan: preostala obrazloženja su lokalna.');
          break;
        }
        report.reserved += prepared.reservation;
        report.aiAttemptedIDs.push(...batch.map(m => m.id));
        this.persist(); // Persist the reservation before the billable request, including across crashes.
        const result = await this.ai.generate(prepared, key);
        report.reserved = Math.max(0, report.reserved - prepared.reservation);
        report.spent += result.cost;
        this.apply(report, result.summaries);
        this.store.write(result.summaries, prepared.cacheKey, 'ai');
        this.persist(); this.changed(true);
      } catch (error) {
        if (error instanceof CancellationError) throw error;
        this.note(`${message(error)} Neutvrđen trošak ostaje rezervisan; zahtev se neće automatski ponoviti.`);
        this.persist();
        break;
      }
    }
  }

  apply(report, summaries) {
    for (const summary of summaries) {
      const match = report.matches.find(m => m.id === summary.matchID);
      if (!match) continue;
      match.summary = summary.text;
      match.summaryFindingIDs = summary.findingIDs;
    }
  }

  getReport(id) {
    if (this.state.report?.id === id) return this.state.report;
    return this.state.history.find(r => r.id === id) || null;
  }

  deleteReport(id) {
    if (this.state.isRunning && this.state.report?.id === id) return;
    this.store.deleteReport(id);
    this.state.history = this.store.reports();
    if (this.state.report?.id === id) this.state.report = this.state.history[0] || null;
    this.changed(true);
  }

  shutdown() {
    if (this.state.isRunning) this.cancel();
    this.loader.stop();
  }
}

module.exports = { Engine };
