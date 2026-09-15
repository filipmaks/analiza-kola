// Port of Tests/FootballCoreTests (AnalysisTests + ParserTests). Same fixtures, same expectations.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../src/core/core.js');

const page = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.json`), 'utf8'));
const S = seconds => seconds * 1000;
const iso = s => Date.parse(s);

// ---------------------------------------------------------------------------
// AnalysisTests
// ---------------------------------------------------------------------------

const now = S(1_800_000_000);
const home = { id: 'home1234', name: 'Domaći' };
const away = { id: 'away1234', name: 'Gosti' };
const fixture = () => C.makeMatch({ id: 'next', home, away, kickoff: now + S(3600), status: 'scheduled' });
const history = (hits, count = 10) => Array.from({ length: count }, (_, i) => C.makeMatch({
  id: `m${i}`, home, away, kickoff: now + S((-i - 1) * 86400),
  regular: { home: i < hits ? 1 : 0, away: 0 }, firstHalf: { home: i < hits ? 1 : 0, away: 0 }
}));
const firstHalfHomeScores = f => f.rule.metric === 'teamGoals' && f.rule.teamID === home.id && f.rule.line === 1 && f.rule.period === 'first' && !f.rule.negated;
const finding = (hits, threshold = 60, count = 10) => C.analyze({
  fixture: fixture(), overall: history(hits, count), venue: [], homeForm: [], awayForm: [], threshold, now
}).findings.find(firstHalfHomeScores);

test('strict threshold and extremes', () => {
  assert.equal(finding(0), undefined);
  assert.equal(finding(6), undefined);
  assert.equal(C.countLabel(finding(7)), '7/10');
  assert.equal(C.rate(finding(10)), 1);
  const result = C.analyze({ fixture: fixture(), overall: history(0), venue: [], homeForm: [], awayForm: [], threshold: 60, now });
  assert.ok(result.findings.some(f => f.rule.metric === 'teamGoals' && f.rule.negated && f.hitIDs.length === 10));
});

test('small sample is never highlighted', () => {
  assert.equal(C.strongEnough(finding(4, 60, 4)), false);
  assert.equal(C.strongEnough(finding(5, 60, 5)), true);
});

test('missing half does not become zero or pull older games', () => {
  const games = history(10, 11);
  games[0].firstHalf = null; games[1].firstHalf = null;
  const result = C.analyze({ fixture: fixture(), overall: games, venue: [], homeForm: [], awayForm: [], threshold: 60, now });
  const f = result.findings.find(firstHalfHomeScores);
  assert.equal(f.matches.length, 8);
  assert.equal(f.sampleCount, 10);
  assert.ok(!f.matches.some(m => m.id === 'm10'));
});

test('identity survives venue swap', () => {
  const match = history(0)[0];
  match.home = away; match.away = home; match.firstHalf = { home: 0, away: 2 };
  assert.equal(C.evaluate(C.makeRule('teamGoals', 'first', home.id, 2), match), true);
  assert.equal(C.sample([match], fixture(), 'venue').length, 0);
  assert.equal(C.sample([match], fixture(), 'overall').length, 1);
});

test('samples are independent and deduplicated', () => {
  const games = history(10);
  assert.equal(C.sample([...games, ...games], fixture(), 'overall').length, 10);
  const result = C.analyze({ fixture: fixture(), overall: games, venue: games, homeForm: [], awayForm: [], threshold: 60, now });
  assert.ok(result.findings.every(f => f.matches.length === 10));
  assert.deepEqual(new Set(result.findings.map(f => f.sample)), new Set(C.SAMPLE_KINDS));
});

test('old matches flagged', () => {
  const games = history(10);
  games[9].kickoff = now - S(7 * 365 * 86400);
  const result = C.analyze({ fixture: fixture(), overall: games, venue: [], homeForm: [], awayForm: [], threshold: 60, now });
  assert.equal(C.containsOldMatches(result.findings[0], now), true);
});

test('excluded and future matches not used', () => {
  const games = history(10);
  games[0].exclusion = 'Friendly'; games[1].status = 'excluded'; games[2].kickoff = fixture().kickoff + S(1);
  assert.equal(C.sample(games, fixture(), 'overall').length, 7);
});

test('second half requires consistent scores', () => {
  const match = history(1)[0];
  match.regular = { home: 4, away: 1 }; match.firstHalf = { home: 3, away: 0 };
  assert.deepEqual(C.score(match, 'second'), { home: 1, away: 1 });
  match.firstHalf = { home: 5, away: 0 }; assert.equal(C.score(match, 'second'), null);
  match.firstHalf = null; assert.equal(C.score(match, 'second'), null);
});

test('form warnings use five plus five', () => {
  const games = history(0);
  for (let i = 0; i < 10; i++) games[i].regular = { home: i < 5 ? 0 : 2, away: 1 };
  const f = C.form(home, games, now);
  assert.equal(f.ppg, 0); assert.equal(f.goalDifference, -5);
  assert.equal(f.notes.length, 2);
  assert.equal(f.results[0], 'I·D');
});

test('report window is exactly 24 hours with exclusive end', () => {
  const report = C.makeReport({ now, leagueIDs: [], threshold: 60, aiBudget: 0.1 });
  const match = fixture(); match.kickoff = now;
  assert.equal(C.includes(report, match), true);
  match.kickoff = now + S(86400); assert.equal(C.includes(report, match), false);
  match.kickoff = now - S(1); assert.equal(C.includes(report, match), false);
  match.kickoff = now; match.status = 'finished'; assert.equal(C.includes(report, match), false);
});

test('budget includes reservation and exact boundary', () => {
  assert.equal(C.AIBudget.permits(0.1, 0.04, 0.04, 0.01), true);
  assert.equal(C.AIBudget.permits(0.1, 0.04, 0.04, 0.03), false);
  assert.ok(Math.abs(C.AIBudget.reservation(1000, 1000) - 0.00525) < 0.000001);
});

test('report round trip preserves continuation and budget', () => {
  const report = C.makeReport({ now, leagueIDs: ['england'], threshold: 60, aiBudget: 0.1 });
  report.queue = [fixture()]; report.completedIDs = ['next']; report.reserved = 0.05; report.aiAttemptedIDs = ['next'];
  const loaded = JSON.parse(JSON.stringify(report));
  assert.equal(loaded.windowEnd, report.windowEnd);
  assert.deepEqual(loaded.aiAttemptedIDs, ['next']); assert.equal(loaded.reserved, 0.05);
});

test('rule ids keep the macOS format', () => {
  assert.equal(C.ruleID(C.makeRule('teamGoals', 'first', 'abc', 1)), 'teamGoals:first:abc:1.0:false');
  assert.equal(C.ruleID(C.makeRule('total', 'full', null, 2.5, true)), 'total:full:both:2.5:true');
  assert.equal(C.ruleTitle(C.makeRule('total', 'full', null, 2.5), fixture()), 'Više od 2,5 golova');
  assert.equal(C.ruleTitle(C.makeRule('teamGoals', 'full', home.id, 2), fixture()), 'Domaći dao 2+ gola');
});

// ---------------------------------------------------------------------------
// ParserTests
// ---------------------------------------------------------------------------

const pnow = S(1_789_430_400);
const noonBelgrade = S(1_789_466_400);

test('captured H2H separates form sections', () => {
  const p = page('h2h');
  assert.equal(p.sections.length, 3);
  assert.equal(p.sections.filter(C.isH2HSection).length, 1);
  assert.equal(p.sections.find(C.isH2HSection).rows.length, 5);
  assert.equal(p.sections[0].title, 'Last matches: Leeds');
});

test('captured home filter is a different sample', () => {
  const rows = page('h2h-home').sections.find(C.isH2HSection).rows;
  assert.ok(rows.every(r => r.home === 'Leeds'));
});

test('captured half time and regular score', () => {
  const p = page('match');
  const base = C.makeMatch({ id: 'Q1TGrNGq', home: { id: 'x', name: 'Leeds' }, away: { id: 'y', name: 'Newcastle' }, kickoff: pnow });
  const m = C.detail(p.detail, base, { timeZone: p.timeZone, now: pnow });
  assert.equal(m.home.id, 'tUxUbLR2'); assert.equal(m.away.id, 'p6ahwuwJ');
  assert.deepEqual(m.firstHalf, { home: 3, away: 0 });
  assert.deepEqual(m.regular, { home: 4, away: 1 });
  assert.deepEqual(C.score(m, 'second'), { home: 1, away: 1 });
});

test('today overview resolves league header and kickoff', () => {
  const p = page('today');
  assert.equal(p.fixtures.length, 7);
  assert.ok(p.fixtures.every(r => r.leaguePath));
  const ajax = p.fixtures.find(r => r.home === 'Ajax');
  assert.equal(ajax.leaguePath, 'netherlands/eredivisie');
  assert.equal(ajax.leagueName, 'Eredivisie');
  const scheduled = p.fixtures.filter(r => r.status === 'scheduled');
  assert.equal(scheduled.length, 4);
  assert.equal(scheduled.map(r => C.row(r, { leagueID: 'x', timeZone: p.timeZone, now: noonBelgrade })).filter(Boolean).length, 4);
  const finished = p.fixtures.filter(r => r.status === 'finished');
  assert.equal(finished.length, 3);
  assert.ok(finished.every(r => C.row(r, { leagueID: 'x', timeZone: p.timeZone, now: noonBelgrade }) === null));
});

test('today scan groups by league and counts only upcoming', () => {
  const p = page('today');
  const scans = C.todayScans(p, C.CATALOG, noonBelgrade);
  assert.deepEqual(scans.map(s => s.league.id), ['spain', 'netherlands']);
  assert.equal(C.upcoming(scans[0], noonBelgrade).length, 3);
  assert.ok(scans.every(s => s.isKnown));
  const late = S(1_789_497_000); // 20:30 Belgrade
  assert.deepEqual(C.todayScans(p, C.CATALOG, late).flatMap(s => C.upcoming(s, late)).map(m => m.home.name), ['Elche']);
  const discovered = C.todayScans(p, C.CATALOG.filter(l => l.id !== 'spain'), noonBelgrade).find(s => !s.isKnown);
  assert.equal(discovered.league.path, 'spain/laliga');
  assert.equal(discovered.league.country, 'Spain');
});

test('today scan never empties the league selection', () => {
  const chosen = ['england', 'italy'];
  assert.deepEqual(C.mergedSelection(chosen, [], noonBelgrade).selection, chosen);
  const scans = C.todayScans(page('today'), C.CATALOG, noonBelgrade);
  const merged = C.mergedSelection(chosen, scans, noonBelgrade);
  assert.deepEqual(new Set(merged.selection), new Set(['england', 'italy', 'spain', 'netherlands']));
  assert.deepEqual(new Set(merged.added), new Set(['spain', 'netherlands']));
  const midnight = S(1_789_509_540); // 23:59 Belgrade
  assert.deepEqual(C.mergedSelection(chosen, scans, midnight).selection, chosen);
});

test('both league fixture tables parse without guessing identities', () => {
  for (const name of ['fixtures-england', 'fixtures-italy']) {
    const p = page(name);
    assert.equal(p.fixtures.length, 3);
    const rows = p.fixtures.map(r => C.row(r, { leagueID: name, timeZone: p.timeZone, now: pnow })).filter(Boolean);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(m => m.status === 'scheduled' && m.regular === null));
  }
});

test('canonical URL order does not define home side', () => {
  const p = page('fixtures-italy');
  const raw = p.fixtures[2];
  assert.equal(raw.home, 'Udinese');
  assert.ok(raw.url.includes('cagliari-SCGVmKHb/udinese-rXw8YKDE'));
  const m = C.row(raw, { leagueID: 'italy', timeZone: p.timeZone, now: pnow, knownTeams: [{ id: 'rXw8YKDE', name: 'Udinese' }] });
  assert.equal(m.home.id, 'rXw8YKDE'); assert.equal(m.away.id, 'SCGVmKHb');
});

test('friendly competition is excluded', () => {
  const p = page('h2h-home');
  const raw = p.sections[0].rows.find(r => r.competition.toLowerCase().includes('friendly'));
  assert.equal(C.row(raw, { leagueID: 'england', timeZone: p.timeZone, now: pnow }).status, 'excluded');
});

test('missing periods and extra time are not invented', () => {
  const p = page('match');
  const raw = Object.assign({}, p.detail, { statusText: 'After extra time', headers: [] });
  const base = C.makeMatch({ id: 'Q1TGrNGq', home: { id: 'tUxUbLR2', name: 'Leeds' }, away: { id: 'p6ahwuwJ', name: 'Newcastle' }, kickoff: pnow });
  const m = C.detail(raw, base, { timeZone: p.timeZone, now: pnow });
  assert.equal(m.regular, null); assert.equal(m.firstHalf, null);
  raw.statusText = 'Finished';
  const ft = C.detail(raw, base, { timeZone: p.timeZone, now: pnow });
  assert.deepEqual(ft.regular, { home: 4, away: 1 }); assert.equal(ft.firstHalf, null);
});

test('invalid identity is rejected', () => {
  const p = page('match');
  const raw = Object.assign({}, p.detail, { homeURL: 'https://www.flashscore.com/team/other/badbad00/' });
  const base = C.makeMatch({ id: 'Q1TGrNGq', home: { id: 'tUxUbLR2', name: 'Leeds' }, away: { id: 'p6ahwuwJ', name: 'Newcastle' }, kickoff: pnow });
  assert.equal(C.detail(raw, base, { timeZone: p.timeZone, now: pnow }), null);
  assert.equal(C.identifiers('https://malicious.example/match/football/a-12345678/b-87654321/?mid=123'), null);
});

test('year rollover and DST window', () => {
  const dec31 = iso('2026-12-31T22:00:00Z');
  assert.equal(C.parseDate('01.01. 12:00', 'Europe/Belgrade', dec31, false), iso('2027-01-01T11:00:00Z'));
  const dst = iso('2026-10-24T12:00:00Z');
  const report = C.makeReport({ now: dst, leagueIDs: [], threshold: 60, aiBudget: 0.1 });
  assert.equal(report.windowEnd - report.createdAt, S(86400));
});

test('dates parse in the page time zone across DST', () => {
  // Summer (UTC+2) and winter (UTC+1) wall clocks in Belgrade.
  assert.equal(C.parseDate('15.09.2026 20:00', 'Europe/Belgrade', pnow, false), iso('2026-09-15T18:00:00Z'));
  assert.equal(C.parseDate('15.12.2026 20:00', 'Europe/Belgrade', pnow, false), iso('2026-12-15T19:00:00Z'));
  assert.equal(C.parseDate('12.03.19', 'Europe/Belgrade', pnow, true), iso('2019-03-11T23:00:00Z'));
  assert.equal(C.parseDate('31.02.2026', 'Europe/Belgrade', pnow, true), null);
  assert.equal(C.parseDate('15.09. 20:00', 'Europe/Belgrade', pnow, true), null, 'historical rows never guess a year');
});

test('preferences are normalized and keep the AI model', () => {
  const p = C.normalizePreferences({ threshold: 150, aiBudget: -3, leagueIDs: ['a', 'a', 5], theme: 'neon', aiModel: '  ' });
  assert.equal(p.threshold, 99); assert.equal(p.aiBudget, 0);
  assert.deepEqual(p.leagueIDs, ['a']); assert.equal(p.theme, 'system'); assert.equal(p.aiModel, C.DEFAULT_MODEL);
});

test('markdown export names discovered leagues', () => {
  const report = C.makeReport({ now, leagueIDs: ['england', 'discovered-wales-cymru-premier'], threshold: 60, aiBudget: 0.1 });
  const md = C.reportMarkdown(report, [...C.CATALOG, { id: 'discovered-wales-cymru-premier', name: 'Cymru Premier' }]);
  assert.match(md, /Lige: Premier League, Cymru Premier/);
});
