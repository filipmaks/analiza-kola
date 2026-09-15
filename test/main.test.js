// Port of Tests/FootballAppTests (storage and AI validation), for the Windows services.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/core/core.js');
const { LocalStore } = require('../src/main/store.js');
const { OpenAIService } = require('../src/main/openai.js');

const tempStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-store-'));
  return { root, store: new LocalStore(root), done: () => fs.rmSync(root, { recursive: true, force: true }) };
};

test('store round trip, update and expiry', () => {
  const { store, done } = tempStore();
  try {
    store.write(Object.assign(C.defaultPreferences(), { threshold: 70 }), 'preferences', 'preferences');
    assert.equal(store.read('preferences').threshold, 70);
    store.write(Object.assign(C.defaultPreferences(), { threshold: 80 }), 'preferences', 'preferences');
    assert.equal(store.read('preferences').threshold, 80);
    assert.equal(store.read('preferences', -1), null);
    const report = C.makeReport({ now: Date.now(), leagueIDs: ['england'], threshold: 60, aiBudget: 0.1 });
    report.reserved = 0.03;
    store.write(report, `report:${report.id}`, 'report');
    assert.equal(store.reports().length, 1);
    assert.equal(store.reports()[0].reserved, 0.03);
  } finally { done(); }
});

test('store survives closing and reopening', () => {
  const { root, store, done } = tempStore();
  try {
    const report = C.makeReport({ now: Date.now(), leagueIDs: ['italy'], threshold: 60, aiBudget: 0.1 });
    store.write(report, `report:${report.id}`, 'report');
    const reopened = new LocalStore(root);
    assert.equal(reopened.reports()[0].id, report.id);
    assert.deepEqual(reopened.reports()[0].leagueIDs, ['italy']);
  } finally { done(); }
});

test('reports are newest first and can be deleted', async () => {
  const { store, done } = tempStore();
  try {
    const a = C.makeReport({ now: 1, leagueIDs: [], threshold: 60, aiBudget: 0 });
    const b = C.makeReport({ now: 2, leagueIDs: [], threshold: 60, aiBudget: 0 });
    store.write(a, `report:${a.id}`, 'report');
    await new Promise(r => setTimeout(r, 5));
    store.write(b, `report:${b.id}`, 'report');
    assert.deepEqual(store.reports().map(r => r.id), [b.id, a.id]);
    store.deleteReport(b.id);
    assert.deepEqual(store.reports().map(r => r.id), [a.id]);
  } finally { done(); }
});

test('damaged and expired cache entries are pruned, reports are kept', () => {
  const { root, store, done } = tempStore();
  try {
    store.write({ id: 'x' }, 'match:x', 'match');
    store.write({ overall: [] }, 'history:y', 'history');
    const report = C.makeReport({ now: Date.now(), leagueIDs: [], threshold: 60, aiBudget: 0 });
    store.write(report, `report:${report.id}`, 'report');
    fs.writeFileSync(path.join(root, 'cache', 'broken.json'), '{not json');
    assert.equal(store.prune(Date.now() + 8 * 86400e3), 3);
    assert.equal(store.read('match:x'), null);
    assert.equal(store.reports().length, 1);
  } finally { done(); }
});

test('AI rejects invented references and numbers', () => {
  const home = { id: 'home1234', name: 'Domaći' };
  const away = { id: 'away1234', name: 'Gosti' };
  const now = Date.now();
  const fixture = C.makeMatch({ id: 'next', home, away, kickoff: now + 3600e3, status: 'scheduled' });
  const games = Array.from({ length: 10 }, (_, i) => C.makeMatch({ id: `h${i + 1}`, home, away, kickoff: now - (i + 1) * 86400e3, regular: { home: 1, away: 0 }, firstHalf: { home: 1, away: 0 } }));
  const report = C.analyze({ fixture, overall: games, venue: [], homeForm: [], awayForm: [], threshold: 60, now });
  const service = new OpenAIService();
  const response = (text, id) => ({
    status: 'completed', usage: { input_tokens: 100, output_tokens: 50 },
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ summaries: [{ matchID: 'next', text, findingIDs: [id] }] }) }] }]
  });
  const id = C.highlighted(report)[0].id;
  assert.equal(service.decodeResponse(response('U međusobnim susretima postoji izražen obrazac. Forma zahteva dodatnu pažnju.', id), [report]).summaries.length, 1);
  assert.throws(() => service.decodeResponse(response('Obrazac je prisutan.', 'invented'), [report]));
  assert.throws(() => service.decodeResponse(response('Tim ima 99% šanse.', id), [report]));
  assert.throws(() => service.decodeResponse(response('Ovo je garantovano.', id), [report]));
  assert.throws(() => service.decodeResponse({}, [report]));
});

test('AI cache key ignores fetch time but tracks changed evidence and model', () => {
  const home = { id: 'home1234', name: 'Domaći' };
  const away = { id: 'away1234', name: 'Gosti' };
  const now = Date.now();
  const fixture = C.makeMatch({ id: 'next', home, away, kickoff: now + 3600e3 });
  const a = C.analyze({ fixture, overall: [], venue: [], homeForm: [], awayForm: [], threshold: 60, now });
  const service = new OpenAIService();
  const initial = service.cacheKey([a], 'gpt-5.4-mini');
  a.fixture.fetchedAt = now + 3600e3;
  assert.equal(service.cacheKey([a], 'gpt-5.4-mini'), initial);
  assert.notEqual(service.cacheKey([a], 'another-model'), initial);
  a.notes.push('Promenjen podatak');
  assert.notEqual(service.cacheKey([a], 'gpt-5.4-mini'), initial);
});
