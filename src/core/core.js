// Fudbalski pregled — analysis core.
// A faithful port of Sources/FootballCore (Models, Analysis, FlashscoreParser).
// No dependencies: the same file runs in the main process, the renderer and tests.
// Instants are epoch milliseconds; Swift Sets are arrays without duplicates.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400 * 1000;
  const BELGRADE = 'Europe/Belgrade';

  // ---------------------------------------------------------------------------
  // Time zones
  // ---------------------------------------------------------------------------

  const formatters = new Map();
  function isValidZone(timeZone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone }); return true; } catch { return false; }
  }
  function zoneOrBelgrade(timeZone) { return timeZone && isValidZone(timeZone) ? timeZone : BELGRADE; }
  function wallClock(ms, timeZone) {
    let f = formatters.get(timeZone);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      formatters.set(timeZone, f);
    }
    const p = {};
    for (const part of f.formatToParts(new Date(ms))) p[part.type] = part.value;
    return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second };
  }
  function offsetAt(ms, timeZone) {
    const w = wallClock(ms, timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
  }
  /** The instant of a wall-clock time in a zone, or null when that time does not exist. */
  function fromWallClock(year, month, day, hour, minute, timeZone) {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    let ms = guess - offsetAt(guess, timeZone);
    const corrected = guess - offsetAt(ms, timeZone);
    if (corrected !== ms) ms = corrected;
    const w = wallClock(ms, timeZone);
    if (w.year !== year || w.month !== month || w.day !== day || w.hour !== hour || w.minute !== minute) return null;
    return ms;
  }
  function sameDay(a, b, timeZone) {
    const x = wallClock(a, timeZone), y = wallClock(b, timeZone);
    return x.year === y.year && x.month === y.month && x.day === y.day;
  }
  function subtractYears(ms, years) {
    const d = new Date(ms);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
  }

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------

  const L = (id, name, country, path, flag) => ({ id, name, country, path, flag });
  const CATALOG = [
    L('england', 'Premier League', 'Engleska', 'england/premier-league', '🇬🇧'),
    L('italy', 'Serie A', 'Italija', 'italy/serie-a', '🇮🇹'),
    L('spain', 'La Liga', 'Španija', 'spain/laliga', '🇪🇸'),
    L('germany', 'Bundesliga', 'Nemačka', 'germany/bundesliga', '🇩🇪'),
    L('france', 'Ligue 1', 'Francuska', 'france/ligue-1', '🇫🇷'),
    L('portugal', 'Liga Portugal', 'Portugal', 'portugal/liga-portugal', '🇵🇹'),
    L('netherlands', 'Eredivisie', 'Holandija', 'netherlands/eredivisie', '🇳🇱'),
    L('belgium', 'Pro League', 'Belgija', 'belgium/jupiler-pro-league', '🇧🇪'),
    L('turkey', 'Süper Lig', 'Turska', 'turkey/super-lig', '🇹🇷'),
    L('scotland', 'Premiership', 'Škotska', 'scotland/premiership', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'),
    L('england-championship', 'Championship', 'Engleska', 'england/championship', '🇬🇧'),
    L('england-league-one', 'League One', 'Engleska', 'england/league-one', '🇬🇧'),
    L('spain-segunda', 'LaLiga 2', 'Španija', 'spain/laliga2', '🇪🇸'),
    L('italy-serie-b', 'Serie B', 'Italija', 'italy/serie-b', '🇮🇹'),
    L('germany-2-bundesliga', '2. Bundesliga', 'Nemačka', 'germany/2-bundesliga', '🇩🇪'),
    L('france-ligue-2', 'Ligue 2', 'Francuska', 'france/ligue-2', '🇫🇷'),
    L('portugal-liga-2', 'Liga Portugal 2', 'Portugal', 'portugal/liga-portugal-2', '🇵🇹'),
    L('netherlands-eerste', 'Eerste Divisie', 'Holandija', 'netherlands/eerste-divisie', '🇳🇱'),
    L('belgium-challenger', 'Challenger Pro League', 'Belgija', 'belgium/challenger-pro-league', '🇧🇪'),
    L('turkey-1-lig', '1. Lig', 'Turska', 'turkey/1-lig', '🇹🇷'),
    L('greece-super-league', 'Super League', 'Grčka', 'greece/super-league', '🇬🇷'),
    L('austria-bundesliga', 'Bundesliga', 'Austrija', 'austria/bundesliga', '🇦🇹'),
    L('switzerland-super-league', 'Super League', 'Švajcarska', 'switzerland/super-league', '🇨🇭'),
    L('denmark-superliga', 'Superliga', 'Danska', 'denmark/superliga', '🇩🇰'),
    L('norway-eliteserien', 'Eliteserien', 'Norveška', 'norway/eliteserien', '🇳🇴'),
    L('sweden-allsvenskan', 'Allsvenskan', 'Švedska', 'sweden/allsvenskan', '🇸🇪'),
    L('croatia-hnl', 'HNL', 'Hrvatska', 'croatia/hnl', '🇭🇷'),
    L('serbia-super-liga', 'Super Liga', 'Srbija', 'serbia/super-liga', '🇷🇸'),
    L('poland-ekstraklasa', 'Ekstraklasa', 'Poljska', 'poland/ekstraklasa', '🇵🇱'),
    L('czech-republic-chance-liga', 'Chance Liga', 'Češka', 'czech-republic/chance-liga', '🇨🇿'),
    L('romania-superliga', 'SuperLiga', 'Rumunija', 'romania/superliga', '🇷🇴'),
    L('brazil-serie-a', 'Serie A', 'Brazil', 'brazil/serie-a', '🇧🇷'),
    L('argentina-liga-profesional', 'Liga Profesional', 'Argentina', 'argentina/liga-profesional', '🇦🇷'),
    L('mexico-liga-mx', 'Liga MX', 'Meksiko', 'mexico/liga-mx', '🇲🇽'),
    L('usa-mls', 'MLS', 'SAD', 'usa/mls', '🇺🇸'),
    L('colombia-primera-a', 'Primera A', 'Kolumbija', 'colombia/primera-a', '🇨🇴'),
    L('saudi-professional-league', 'Saudi Pro League', 'Saudijska Arabija', 'saudi-arabia/saudi-professional-league', '🇸🇦'),
    L('japan-j-league', 'J1 League', 'Japan', 'japan/j1-league', '🇯🇵'),
    L('south-korea-k-league-1', 'K League 1', 'Južna Koreja', 'south-korea/k-league-1', '🇰🇷'),
    L('australia-a-league', 'A-League', 'Australija', 'australia/a-league', '🇦🇺'),
    L('uae-league', 'UAE Pro League', 'Ujedinjeni Arapski Emirati', 'uae/uae-league', '🇦🇪')
  ];
  const fixturesURL = league => `https://www.flashscore.com/football/${league.path}/fixtures/`;

  const PERIODS = ['full', 'first', 'second'];
  const PERIOD_LABEL = { full: 'Cela utakmica', first: '1. poluvreme', second: '2. poluvreme' };
  const SAMPLE_KINDS = ['overall', 'venue'];
  const SAMPLE_LABEL = { overall: 'Svi međusobni susreti', venue: 'Isti domaćin' };

  function makeMatch(fields) {
    return Object.assign({
      id: '', home: { id: '', name: '' }, away: { id: '', name: '' }, kickoff: 0,
      leagueID: '', competition: '', status: 'finished', regular: null, firstHalf: null,
      sourceURL: '', fetchedAt: Date.now(), exclusion: null
    }, fields);
  }
  const eligible = m => m.status === 'finished' && m.exclusion == null;
  const sameScore = (a, b) => !!a && !!b && a.home === b.home && a.away === b.away;
  function score(match, period) {
    if (period === 'full') return match.regular || null;
    if (period === 'first') return match.firstHalf || null;
    const ft = match.regular, ht = match.firstHalf;
    if (!ft || !ht || ft.home < ht.home || ft.away < ht.away) return null;
    return { home: ft.home - ht.home, away: ft.away - ht.away };
  }

  // Swift prints doubles with at least one decimal ("1.0", "2.5"); rule ids keep that shape.
  const swiftDouble = n => Number.isInteger(n) ? n.toFixed(1) : String(n);
  const makeRule = (metric, period, teamID = null, line = 0, negated = false) => ({ metric, period, teamID, line, negated });
  const ruleID = r => `${r.metric}:${r.period}:${r.teamID ?? 'both'}:${swiftDouble(r.line)}:${r.negated}`;
  const ruleFamily = r => `${r.metric}:${r.teamID ?? 'both'}`;

  /** true / false, or null when the match has no data for the rule. */
  function evaluate(rule, match) {
    const s = score(match, rule.period);
    if (!s) return null;
    let value;
    if (rule.metric === 'total') value = s.home + s.away > rule.line;
    else if (rule.metric === 'bothScore') value = s.home > 0 && s.away > 0;
    else {
      const teamID = rule.teamID;
      if (!teamID || (teamID !== match.home.id && teamID !== match.away.id)) return null;
      const own = teamID === match.home.id ? s.home : s.away;
      const other = teamID === match.home.id ? s.away : s.home;
      switch (rule.metric) {
        case 'teamGoals': value = own >= Math.trunc(rule.line); break;
        case 'win': value = own > other; break;
        case 'draw': value = own === other; break;
        case 'loss': value = own < other; break;
        case 'unbeaten': value = own >= other; break;
        default: return null;
      }
    }
    return rule.negated ? !value : value;
  }
  function ruleTitle(rule, fixture) {
    const team = rule.teamID === fixture.home.id ? fixture.home.name : fixture.away.name;
    const n = rule.negated;
    switch (rule.metric) {
      case 'total': return `${n ? 'Manje' : 'Više'} od ${rule.line.toFixed(1).replace('.', ',')} golova`;
      case 'teamGoals': return `${team} ${n ? 'nije dao' : 'dao'} ${Math.trunc(rule.line)}+ gol${rule.line > 1 ? 'a' : ''}`;
      case 'bothScore': return n ? 'Bar jedan tim nije dao gol' : 'Oba tima dala gol';
      case 'win': return `${team} ${n ? 'nije pobedio' : 'pobedio'}`;
      case 'draw': return n ? 'Meč nije završen remijem' : 'Meč završen remijem';
      case 'loss': return `${team} ${n ? 'nije izgubio' : 'izgubio'}`;
      case 'unbeaten': return `${team} ${n ? 'izgubio' : 'ostao neporažen'}`;
      default: return '';
    }
  }

  const rate = f => f.matches.length === 0 ? 0 : f.hitIDs.length / f.matches.length;
  const strongEnough = f => f.matches.length >= 5;
  const countLabel = f => `${f.hitIDs.length}/${f.matches.length}`;
  const percentLabel = f => `${Math.round(rate(f) * 100)}%`;
  function containsOldMatches(f, now) {
    const cutoff = subtractYears(now, 5);
    return f.matches.some(m => m.kickoff < cutoff);
  }
  /** The strongest finding of each family, at most three, and only with five or more games. */
  function highlighted(matchReport) {
    const families = new Set();
    const out = [];
    for (const f of matchReport.findings) {
      if (!strongEnough(f)) continue;
      const family = ruleFamily(f.rule);
      if (families.has(family)) continue;
      families.add(family);
      out.push(f);
    }
    return out.slice(0, 3);
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().toUpperCase();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }).toUpperCase();
  }
  function makeReport({ now, leagueIDs, threshold, aiBudget }) {
    return {
      id: uuid(), createdAt: now, windowEnd: now + DAY, leagueIDs: [...leagueIDs], threshold,
      matches: [], queue: [], completedIDs: [], discoveredLeagueIDs: [], notes: [],
      state: 'U toku', spent: 0, reserved: 0, aiAttemptedIDs: [], aiBudget, pageCount: 0, analysisVersion: '1.0'
    };
  }
  const includes = (report, match) => match.status === 'scheduled' && match.kickoff >= report.createdAt && match.kickoff < report.windowEnd;

  const DEFAULT_MODEL = 'gpt-5.4-mini';
  function defaultPreferences() {
    return { leagueIDs: ['england', 'italy'], threshold: 60, theme: 'system', aiBudget: 0.10, aiModel: DEFAULT_MODEL };
  }
  function normalizePreferences(raw) {
    const d = defaultPreferences();
    const p = Object.assign(d, raw || {});
    p.leagueIDs = Array.isArray(p.leagueIDs) ? [...new Set(p.leagueIDs.filter(x => typeof x === 'string'))] : d.leagueIDs;
    p.threshold = Math.min(99, Math.max(0, Number.isFinite(+p.threshold) ? +p.threshold : 60));
    p.aiBudget = Math.min(10, Math.max(0, Number.isFinite(+p.aiBudget) ? +p.aiBudget : 0.10));
    p.theme = ['system', 'light', 'dark'].includes(p.theme) ? p.theme : 'system';
    p.aiModel = typeof p.aiModel === 'string' && p.aiModel.trim() ? p.aiModel.trim() : DEFAULT_MODEL;
    return p;
  }

  // ---------------------------------------------------------------------------
  // Today scan
  // ---------------------------------------------------------------------------

  /** Games that can still be analysed; started or finished games never drive the selection. */
  const upcoming = (scan, now) => scan.matches.filter(m => m.status === 'scheduled' && m.kickoff > now);
  /** A scan only ever adds known leagues with games still to come; it never removes a choice. */
  function mergedSelection(current, scans, now) {
    const chosen = new Set(current);
    const playing = scans.filter(s => s.isKnown && upcoming(s, now).length > 0).map(s => s.league.id);
    const added = playing.filter(id => !chosen.has(id));
    return { selection: [...new Set([...current, ...playing])], added };
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  function rulesFor(fixture) {
    const rules = [];
    for (const period of PERIODS) {
      for (const line of (period === 'full' ? [0.5, 1.5, 2.5, 3.5] : [0.5, 1.5])) rules.push(makeRule('total', period, null, line));
      rules.push(makeRule('bothScore', period));
      for (const team of [fixture.home, fixture.away]) {
        for (const goals of [1, 2]) rules.push(makeRule('teamGoals', period, team.id, goals));
        // Win/loss complements already cover unbeaten. A single draw avoids duplicates.
        rules.push(makeRule('win', period, team.id));
        rules.push(makeRule('loss', period, team.id));
      }
      rules.push(makeRule('draw', period, fixture.home.id));
    }
    return rules.flatMap(rule => [rule, Object.assign({}, rule, { negated: true })]);
  }
  function sample(matches, fixture, kind) {
    const seen = new Set();
    const pair = [fixture.home.id, fixture.away.id].sort().join('|');
    return matches.filter(m => {
      if (!eligible(m) || !(m.kickoff < fixture.kickoff)) return false;
      if ([m.home.id, m.away.id].sort().join('|') !== pair) return false;
      if (kind !== 'overall' && m.home.id !== fixture.home.id) return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).sort((a, b) => b.kickoff - a.kickoff).slice(0, 10);
  }
  function analyze({ fixture, overall, venue, homeForm, awayForm, threshold, now }) {
    let findings = [];
    const notes = [];
    for (const kind of SAMPLE_KINDS) {
      const chosen = sample(kind === 'overall' ? overall : venue, fixture, kind);
      if (chosen.length < 5) notes.push(`${SAMPLE_LABEL[kind]}: nedovoljan uzorak (${chosen.length}/10).`);
      const missingHT = chosen.filter(m => m.firstHalf == null).length;
      if (missingHT > 0) notes.push(`${SAMPLE_LABEL[kind]}: poluvreme nedostaje za ${missingHT} od ${chosen.length} susreta.`);
      for (const rule of rulesFor(fixture)) {
        const valid = chosen.filter(m => evaluate(rule, m) !== null);
        if (valid.length === 0) continue;
        const hits = valid.filter(m => evaluate(rule, m) === true).map(m => m.id);
        // Compare unrounded values: exactly 60% never passes a 60% threshold.
        if (!(hits.length * 100 > threshold * valid.length)) continue;
        findings.push({ id: `${fixture.id}:${kind}:${ruleID(rule)}`, rule, sample: kind, matches: valid, hitIDs: hits, sampleCount: chosen.length });
      }
    }
    findings.sort((x, y) => {
      if (rate(x) !== rate(y)) return rate(y) - rate(x);
      if (x.matches.length !== y.matches.length) return y.matches.length - x.matches.length;
      const a = x.matches.length ? Math.min(...x.matches.map(m => m.kickoff)) : -Infinity;
      const b = y.matches.length ? Math.min(...y.matches.map(m => m.kickoff)) : -Infinity;
      if (a === b) return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
      return b - a;
    });
    const forms = [form(fixture.home, homeForm, now), form(fixture.away, awayForm, now)];
    for (const f of forms) {
      for (const finding of findings.filter(x => x.sample === 'overall' && strongEnough(x) && x.rule.teamID === f.team.id && !x.rule.negated)) {
        const valid = f.matches.filter(m => evaluate(finding.rule, m) !== null);
        if (valid.length < 5) continue;
        const r = valid.filter(m => evaluate(finding.rule, m) === true).length / valid.length;
        if (Math.abs(r - rate(finding)) >= 0.20 - 0.00001) {
          notes.push(`Forma odstupa: ${ruleTitle(finding.rule, fixture)}, ${PERIOD_LABEL[finding.rule.period].toLowerCase()} — ${Math.round(r * 100)}% u poslednjim ${valid.length} nastupa, H2H ${percentLabel(finding)}.`);
        }
      }
    }
    if (findings.some(x => containsOldMatches(x, now))) notes.push('H2H uzorak sadrži susrete starije od pet godina.');
    if (findings.length === 0) notes.push('Nema obrazaca iznad praga sa dostupnim podacima.');
    return { id: fixture.id, fixture, findings, forms, notes, summary: null, summaryFindingIDs: [] };
  }
  function form(team, history, before) {
    const seen = new Set();
    const matches = history.filter(m => {
      if (!eligible(m) || !(m.kickoff < before) || (m.home.id !== team.id && m.away.id !== team.id) || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).sort((a, b) => b.kickoff - a.kickoff).slice(0, 10);
    const points = m => {
      const s = m.regular;
      if (!s) return null;
      const own = m.home.id === team.id ? s.home : s.away;
      const other = m.home.id === team.id ? s.away : s.home;
      return own > other ? 3 : own === other ? 1 : 0;
    };
    const latest = matches.slice(0, 5);
    const valid = latest.map(points).filter(x => x !== null);
    const previous = matches.slice(5, 10).map(points).filter(x => x !== null);
    const sum = a => a.reduce((x, y) => x + y, 0);
    const ppg = valid.length ? sum(valid) / valid.length : null;
    const notes = [];
    if (valid.length === 5 && ppg !== null && ppg < 1) notes.push('Slaba rezultatska forma: manje od boda po meču u poslednjih pet.');
    if (valid.length === 5 && previous.length === 5 && ppg !== null && sum(previous) / 5 - ppg >= 0.6 - 0.00001) notes.push('Pad forme u odnosu na prethodnih pet utakmica.');
    if (valid.length < 5) notes.push('Nema pet kompletnih rezultata za procenu forme.');
    const goalDifference = valid.length === latest.length && latest.length > 0
      ? latest.reduce((acc, m) => acc + (m.home.id === team.id ? m.regular.home - m.regular.away : m.regular.away - m.regular.home), 0)
      : null;
    const results = latest.map(m => {
      const p = points(m);
      const r = p === null ? '?' : p === 3 ? 'P' : p === 1 ? 'N' : 'I';
      return `${r}·${m.home.id === team.id ? 'D' : 'G'}`;
    });
    return { id: team.id, team, matches, results, ppg, goalDifference, notes };
  }

  const AIBudget = {
    inputPrice: 0.75 / 1000000,
    outputPrice: 4.50 / 1000000,
    reservation(inputTokens, maxOutputTokens) { return inputTokens * this.inputPrice + maxOutputTokens * this.outputPrice; },
    permits(limit, spent, reserved, next) { return next >= 0 && spent + reserved + next <= limit; }
  };

  // ---------------------------------------------------------------------------
  // Flashscore parser
  // ---------------------------------------------------------------------------

  const excludedMarkers = ['friendly', 'abandoned', 'cancelled', 'canceled', 'awarded', 'walkover', 'postponed', 'interrupted'];
  function excluded(value) {
    const lower = String(value || '').toLowerCase();
    for (const marker of excludedMarkers) if (lower.includes(marker)) return `Izuzet meč: ${marker}.`;
    return null;
  }
  function identifiers(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || !['www.flashscore.com', 'flashscore.com'].includes(url.hostname)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const football = segments.indexOf('football');
    const id = url.searchParams.get('mid');
    if (football < 0 || segments.length <= football + 2 || !id) return null;
    const teamID = slug => {
      const suffix = slug.split('-').filter(Boolean).pop() || '';
      return /^[\p{L}\p{N}]{8}$/u.test(suffix) ? suffix : null;
    };
    const home = teamID(segments[football + 1]);
    const away = teamID(segments[football + 2]);
    if (!home || !away) return null;
    return { match: id, home, away };
  }
  function twoDigitYear(yy, now) {
    // Matches the ICU default window: roughly 80 years back and 20 years ahead.
    const current = new Date(now).getUTCFullYear();
    let year = Math.floor((current - 80) / 100) * 100 + yy;
    if (year <= current - 80) year += 100;
    return year;
  }
  function parseDate(raw, timeZone, now, historical) {
    const clean = String(raw || '').replace(/ /g, ' ').trim();
    const zone = zoneOrBelgrade(timeZone);
    let m;
    if ((m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}) (\d{1,2}):(\d{2})$/))) return fromWallClock(+m[3], +m[2], +m[1], +m[4], +m[5], zone);
    if ((m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/))) return fromWallClock(twoDigitYear(+m[3], now), +m[2], +m[1], 0, 0, zone);
    if ((m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return fromWallClock(+m[3], +m[2], +m[1], 0, 0, zone);
    if (!historical && (m = clean.match(/^(\d{1,2})\.(\d{1,2})\. (\d{1,2}):(\d{2})$/))) {
      const year = wallClock(now, zone).year;
      const candidates = [year - 1, year, year + 1]
        .map(y => fromWallClock(y, +m[2], +m[1], +m[3], +m[4], zone))
        .filter(x => x !== null);
      if (!candidates.length) return null;
      return candidates.reduce((best, x) => Math.abs(x - now) < Math.abs(best - now) ? x : best);
    }
    return null;
  }
  const fold = s => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  function row(raw, { leagueID, timeZone, now, knownTeams = [] }) {
    const ids = identifiers(raw.url);
    if (!ids || !raw.home || !raw.away) return null;
    const date = parseDate(raw.date, timeZone, now, raw.status === 'finished');
    if (date === null) return null;
    const known = name => knownTeams.find(t => fold(t.name) === fold(name)) || null;
    const homeKnown = known(raw.home);
    const awayKnown = known(raw.away);
    if (knownTeams.length && !homeKnown && !awayKnown) return null;
    const pair = new Set([ids.home, ids.away]);
    if (homeKnown && !pair.has(homeKnown.id)) return null;
    if (awayKnown && !pair.has(awayKnown.id)) return null;
    // URL slugs are an unordered pair, NOT home/away roles. Resolve known clubs by displayed name.
    const other = id => id === ids.home ? ids.away : ids.home;
    const homeID = homeKnown ? homeKnown.id : awayKnown ? other(awayKnown.id) : `unresolved-home:${ids.match}`;
    const awayID = awayKnown ? awayKnown.id : homeKnown ? other(homeKnown.id) : `unresolved-away:${ids.match}`;
    const status = ['scheduled', 'finished', 'excluded', 'unknown'].includes(raw.status) ? raw.status : 'unknown';
    const exclusion = excluded(`${raw.competition} ${raw.statusText}`);
    // H2H final scores may include extra time. Match details must confirm regular time before analysis.
    return makeMatch({
      id: ids.match, home: { id: homeID, name: raw.home }, away: { id: awayID, name: raw.away }, kickoff: date,
      leagueID, competition: raw.competition || '', status: exclusion === null ? status : 'excluded',
      regular: null, firstHalf: null, sourceURL: raw.url, fetchedAt: now, exclusion
    });
  }
  function detail(raw, base, { timeZone, now }) {
    const ids = identifiers(raw.url);
    if (!ids || ids.match !== base.id) return null;
    const lastSegment = u => String(u || '').split('/').filter(Boolean).pop() || null;
    const homeID = lastSegment(raw.homeURL), awayID = lastSegment(raw.awayURL);
    if (!homeID || !awayID || homeID === awayID) return null;
    if ([homeID, awayID].sort().join('|') !== [ids.home, ids.away].sort().join('|')) return null;
    const match = JSON.parse(JSON.stringify(base));
    match.home = { id: homeID, name: raw.home };
    match.away = { id: awayID, name: raw.away };
    match.fetchedAt = now;
    const date = parseDate(raw.date, timeZone, now, false);
    if (date !== null) match.kickoff = date;
    const exclusion = excluded(raw.statusText);
    if (exclusion) { match.status = 'excluded'; match.exclusion = exclusion; return match; }
    const state = String(raw.statusText || '').toLowerCase();
    const finished = state === 'finished' || state.includes('after extra time') || state.includes('after penalties');
    if (!finished) {
      match.status = !state || state.includes('not started') || state.includes('scheduled') ? 'scheduled' : 'unknown';
      match.regular = null; match.firstHalf = null;
      return match;
    }
    match.status = 'finished';
    const periodScore = label => {
      const header = (raw.headers || []).find(h => h.label === label);
      if (!header) return null;
      const parts = String(header.score).split('-').map(x => x.trim()).filter(x => /^\d+$/.test(x)).map(Number);
      return parts.length === 2 ? { home: parts[0], away: parts[1] } : null;
    };
    const rawScore = Array.isArray(raw.score) && raw.score.length === 2 ? { home: raw.score[0], away: raw.score[1] } : null;
    match.firstHalf = periodScore('1st Half');
    const second = periodScore('2nd Half');
    if (match.firstHalf && second) {
      match.regular = { home: match.firstHalf.home + second.home, away: match.firstHalf.away + second.away };
      if (state === 'finished' && rawScore && !sameScore(match.regular, rawScore)) { match.regular = null; match.firstHalf = null; }
    } else if (state === 'finished' && rawScore) {
      match.regular = rawScore;
    } else {
      match.regular = null;
    }
    const ft = match.regular, ht = match.firstHalf;
    if (ft && ht && (ht.home > ft.home || ht.away > ft.away)) match.firstHalf = null;
    return match;
  }
  const isH2HSection = section => String(section.title || '').toLowerCase().includes('head-to-head');

  /** Groups the daily overview by league header. Rows without a printed kickoff are skipped. */
  function todayScans(page, knownLeagues, now) {
    const zone = zoneOrBelgrade(page.timeZone);
    const knownByPath = new Map();
    for (const league of knownLeagues) if (!knownByPath.has(league.path)) knownByPath.set(league.path, league);
    const grouped = new Map();
    for (const raw of page.fixtures || []) {
      const path = raw.leaguePath || '';
      if (!path) continue;
      const known = knownByPath.get(path) || null;
      const discoveredID = 'discovered-' + path.replace(/\//g, '-');
      const match = row(raw, { leagueID: known ? known.id : discoveredID, timeZone: zone, now });
      if (!match || !sameDay(match.kickoff, now, zone)) continue;
      const country = raw.leagueCountry ? raw.leagueCountry.toLowerCase().replace(/(^|[\s-])\p{L}/gu, c => c.toUpperCase()) : '';
      const league = known || { id: discoveredID, name: raw.leagueName || path.replace(/\//g, ' · '), country, path, flag: '🌐' };
      if (!grouped.has(league.id)) grouped.set(league.id, { league, matches: [], isKnown: !!known });
      grouped.get(league.id).matches.push(match);
    }
    return [...grouped.values()]
      .map(s => Object.assign(s, { matches: s.matches.sort((a, b) => a.kickoff - b.kickoff) }))
      .sort((a, b) => {
        const x = upcoming(a, now).length, y = upcoming(b, now).length;
        return x !== y ? y - x : a.league.name.localeCompare(b.league.name, 'sr', { sensitivity: 'base' });
      });
  }

  // ---------------------------------------------------------------------------
  // Display helpers shared by the renderer and exports
  // ---------------------------------------------------------------------------

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
  const pad = n => String(n).padStart(2, '0');
  function dateText(ms, withTime = true) {
    const w = wallClock(ms, BELGRADE);
    return withTime ? `${pad(w.day)}. ${MONTHS[w.month - 1]} · ${pad(w.hour)}:${pad(w.minute)}` : `${pad(w.day)}.${pad(w.month)}.${w.year}.`;
  }
  function reportMarkdown(report, leagues) {
    const names = report.leagueIDs.map(id => (leagues.find(l => l.id === id) || { name: id }).name).join(', ');
    const lines = ['# Fudbalski pregled', '', `- Kreirano: ${dateText(report.createdAt)}`, `- Prozor: ${dateText(report.createdAt)} – ${dateText(report.windowEnd)}`,
      `- Status: ${report.state}`, `- Lige: ${names}`, '', '> Istorijska učestalost opisuje uzorak, a ne verovatnoću sledećeg ishoda.', ''];
    for (const m of report.matches) {
      lines.push(`## ${m.fixture.home.name} – ${m.fixture.away.name}`, '', `Termin: ${dateText(m.fixture.kickoff)}`, '');
      for (const f of highlighted(m)) lines.push(`- ${ruleTitle(f.rule, m.fixture)}: ${countLabel(f)}, ${percentLabel(f)}`);
      if (m.summary) lines.push('', m.summary);
      lines.push('');
    }
    if (report.notes.length) lines.push('## Napomene', '', ...report.notes.map(n => `- ${n}`));
    return lines.join('\n') + '\n';
  }

  return {
    DAY, BELGRADE, CATALOG, PERIODS, PERIOD_LABEL, SAMPLE_KINDS, SAMPLE_LABEL, DEFAULT_MODEL, AIBudget,
    fixturesURL, makeMatch, eligible, score, makeRule, ruleID, ruleFamily, evaluate, ruleTitle,
    rate, strongEnough, countLabel, percentLabel, containsOldMatches, highlighted,
    makeReport, includes, defaultPreferences, normalizePreferences, upcoming, mergedSelection,
    rulesFor, sample, analyze, form,
    excluded, identifiers, parseDate, row, detail, isH2HSection, todayScans,
    wallClock, fromWallClock, sameDay, dateText, reportMarkdown, uuid
  };
});
