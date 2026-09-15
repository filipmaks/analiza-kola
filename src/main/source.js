// Port of FlashscoreSource.swift. Reads public pages through WebLoader and the shared adapter.
'use strict';
const fs = require('fs');
const C = require('../core/core.js');
const { SourceError, CancellationError } = require('./loader.js');

const HOUR = 3600e3;

class FlashscoreSource {
  constructor(loader, store, adapterPath) {
    this.loader = loader;
    this.store = store;
    this.script = fs.readFileSync(adapterPath, 'utf8');
    this.progress = null;
    /** Set when a schedule parsed only partially, so the report can say so. */
    this.lastFixtureWarning = null;
  }

  static url(source, route = '') {
    if (!C.identifiers(source)) throw new SourceError('Neispravan link utakmice.');
    const url = new URL(source);
    const segments = url.pathname.split('/').filter(Boolean);
    url.pathname = '/' + segments.slice(0, 4).join('/') + '/' + route;
    return url.toString();
  }

  async page() {
    const value = await this.loader.evaluate(this.script);
    if (typeof value !== 'string') throw new SourceError('Nije moguće pročitati Flashscore prikaz.');
    return JSON.parse(value);
  }

  async fixtures(league, now) {
    this.progress?.(`Raspored · ${league.name}`);
    await this.loader.load(C.fixturesURL(league));
    await this.loader.waitFor("document.querySelectorAll('.event__match').length > 0 || /No matches found|No matches scheduled|No matches available/i.test(document.body.innerText)");
    await this.loader.settle("document.querySelectorAll('.event__match').length");
    const snapshot = await this.page();
    if (!snapshot.fixtures.length && !snapshot.empty) throw new SourceError(`Raspored za ${league.name} nije dostupan.`);
    const rows = snapshot.fixtures.map(r => C.row(r, { leagueID: league.id, timeZone: snapshot.timeZone, now })).filter(Boolean);
    // A changed DOM must not masquerade as an empty day, but a few odd rows must not discard the league.
    if (!rows.length && snapshot.fixtures.length) throw new SourceError(`Nijedan termin u ligi ${league.name} nije prepoznat. Raspored nije označen kao potpun.`);
    this.lastFixtureWarning = rows.length !== snapshot.fixtures.length
      ? `${league.name}: ${snapshot.fixtures.length - rows.length} od ${snapshot.fixtures.length} termina nije prepoznato; raspored može biti nepotpun.`
      : null;
    return rows;
  }

  async todayLeagues(knownLeagues, now = Date.now()) {
    this.progress?.('Skeniram današnje lige');
    await this.loader.load('https://www.flashscore.com/football/');
    await this.loader.waitFor("document.querySelectorAll('.event__match').length > 0 || /No matches found|No matches scheduled|No matches available|No data available/i.test(document.body.innerText)");
    await this.loader.settle("document.querySelectorAll('.event__match').length");
    return C.todayScans(await this.page(), knownLeagues, now);
  }

  async detail(match) {
    const cached = this.store.read(`match:${match.id}`, 7 * 24 * HOUR);
    if (cached) return cached;
    this.progress?.(`Rezultati · ${match.home.name} – ${match.away.name}`);
    await this.loader.load(FlashscoreSource.url(match.sourceURL));
    await this.loader.waitFor(`!!document.querySelector('.duelParticipant__home a[href*="/team/"]') && !!document.querySelector('.duelParticipant__away a[href*="/team/"]')`);
    // Summary period headers are loaded separately from the participant header.
    if (match.status === 'finished') {
      try { await this.loader.waitFor("document.querySelectorAll('.wclHeaderSection--summary').length > 0", 8); }
      catch (error) { if (!(error instanceof SourceError) || error.stopsRun) throw error; /* Missing periods remain empty. */ }
    }
    let resolved = null;
    const deadline = Date.now() + 12000;
    do {
      await this.loader.checkBlock();
      const snapshot = await this.page();
      if (snapshot.detail) resolved = C.detail(snapshot.detail, match, { timeZone: snapshot.timeZone, now: Date.now() });
      if (resolved) break;
      await this.loader.sleep(500);
    } while (Date.now() < deadline);
    if (!resolved) throw new SourceError(`Identitet ili rezultat meča ${match.home.name} – ${match.away.name} nije potvrđen.`);
    if (resolved.status === 'finished' || resolved.status === 'excluded') this.store.write(resolved, `match:${match.id}`, 'match');
    return resolved;
  }

  async expand(sectionIndex) {
    // The site renders five rows initially. Expanding the public table is throttled like navigation.
    await this.loader.throttleExpansion();
    const count = await this.loader.evaluate(`document.querySelectorAll('.h2h__section')[${sectionIndex}]?.querySelectorAll('.h2h__row').length || 0`) || 0;
    const clicked = await this.loader.evaluate(`(() => { const b = document.querySelectorAll('.h2h__section')[${sectionIndex}]?.querySelector('button.wclButtonLink--h2h'); if (!b) return false; b.click(); return true; })()`);
    if (clicked !== true) return false;
    await this.loader.waitFor(`(document.querySelectorAll('.h2h__section')[${sectionIndex}]?.querySelectorAll('.h2h__row').length || 0) > ${count} || !document.querySelectorAll('.h2h__section')[${sectionIndex}]?.querySelector('button.wclButtonLink--h2h')`, 12);
    return true;
  }

  async histories(fixture) {
    const key = `history:${fixture.id}`;
    const cached = this.store.read(key, 6 * HOUR);
    if (cached) return cached;
    this.progress?.(`Međusobni susreti · ${fixture.home.name} – ${fixture.away.name}`);
    const knownTeams = [fixture.home, fixture.away];
    const parse = (section, page) => section.rows.map(r => C.row(r, { leagueID: fixture.leagueID, timeZone: page.timeZone, now: Date.now(), knownTeams })).filter(Boolean);

    await this.loader.load(FlashscoreSource.url(fixture.sourceURL, 'h2h/overall/'));
    await this.loader.waitFor("document.querySelectorAll('.h2h__section').length > 0");
    let snapshot = await this.page();
    if (!snapshot.sections.some(C.isH2HSection)) throw new SourceError('H2H tabela nije prepoznata; forma neće biti korišćena umesto H2H.');
    const warnings = [];
    for (const initial of snapshot.sections) {
      for (let attempt = 0; attempt < 20; attempt++) {
        snapshot = await this.page();
        const section = snapshot.sections.find(s => s.index === initial.index);
        if (!section) break;
        const valid = parse(section, snapshot).filter(m => C.eligible(m) && m.id !== fixture.id);
        if (valid.length >= 10 || !section.more) break;
        if (!await this.expand(section.index)) break;
      }
    }
    snapshot = await this.page();
    const rows = (section, page) => {
      if (!section) return [];
      const parsed = parse(section, page);
      if (parsed.length !== section.rows.length) warnings.push('Neki istorijski redovi nisu prepoznati; uzorak može biti nepotpun.');
      return parsed.filter(m => C.eligible(m) && m.id !== fixture.id && m.kickoff < fixture.kickoff).slice(0, 10);
    };
    const overall = rows(snapshot.sections.find(C.isH2HSection), snapshot);
    const formSections = snapshot.sections.filter(s => !C.isH2HSection(s));
    const homeSection = formSections.find(s => s.title.toLowerCase() === `last matches: ${fixture.home.name.toLowerCase()}`);
    const awaySection = formSections.find(s => s.title.toLowerCase() === `last matches: ${fixture.away.name.toLowerCase()}`);
    const homeForm = rows(homeSection, snapshot);
    const awayForm = rows(awaySection, snapshot);
    if (!homeSection || !awaySection) warnings.push('Forma jednog kluba nije dostupna.');

    await this.loader.load(FlashscoreSource.url(fixture.sourceURL, 'h2h/home/'));
    await this.loader.waitFor("document.querySelectorAll('.h2h__section').length > 0");
    let homePage = await this.page();
    for (let attempt = 0; attempt < 30; attempt++) {
      const section = homePage.sections.find(C.isH2HSection);
      if (!section) break;
      const valid = parse(section, homePage).filter(m => C.eligible(m) && m.home.id === fixture.home.id && m.id !== fixture.id);
      if (valid.length >= 10 || !section.more) break;
      if (!await this.expand(section.index)) break;
      homePage = await this.page();
    }
    const venueSection = homePage.sections.find(C.isH2HSection);
    const venue = venueSection
      ? parse(venueSection, homePage).filter(m => C.eligible(m) && m.home.id === fixture.home.id && m.id !== fixture.id && m.kickoff < fixture.kickoff).slice(0, 10)
      : [];
    if (!venueSection) warnings.push('H2H uzorak sa istim domaćinom nije dostupan.');
    const bundle = { overall, venue, homeForm, awayForm, warnings };
    this.store.write(bundle, key, 'history');
    return bundle;
  }

  async enriched(matches) {
    const result = [];
    const warnings = [];
    for (const match of matches) {
      if (this.loader.cancelled) throw new CancellationError();
      try { result.push(await this.detail(match)); }
      catch (error) {
        if (error instanceof CancellationError || (error instanceof SourceError && error.stopsRun)) throw error;
        result.push(match);
        warnings.push(`${match.home.name} – ${match.away.name}: rezultat nije potvrđen.`);
      }
    }
    return { matches: result, warnings };
  }
}

module.exports = { FlashscoreSource };
