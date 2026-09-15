// Live check against the real Flashscore site, mirroring the macOS testLiveSourceSmokeOnlyWhenRequested.
// Network access only when run explicitly:  npm run smoke   (uses Electron, not plain Node)
'use strict';
const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const C = require('../src/core/core.js');
const { LocalStore } = require('../src/main/store.js');
const { WebLoader } = require('../src/main/loader.js');
const { FlashscoreSource } = require('../src/main/source.js');

const leagueID = process.env.FOOTBALL_LIVE_LEAGUE || 'italy';
const fail = message => { console.error(`LIVE FAILED: ${message}`); app.exit(1); };

app.whenReady().then(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-live-'));
  const loader = new WebLoader();
  const source = new FlashscoreSource(loader, new LocalStore(root), path.join(__dirname, '..', 'resources', 'Flashscore.js'));
  source.progress = text => console.log(`… ${text}`);
  loader.begin();
  try {
    const now = Date.now();
    const scans = await source.todayLeagues(C.CATALOG, now);
    const upcoming = scans.reduce((n, s) => n + C.upcoming(s, now).length, 0);
    console.log(`TODAY: ${scans.length} leagues, ${upcoming} upcoming`);
    if (!scans.length) return fail('daily overview returned no leagues');

    const league = C.CATALOG.find(l => l.id === leagueID);
    const fixtures = await source.fixtures(league, now);
    if (!fixtures.length) return fail(`no fixtures for ${league.name}`);
    const fixture = await source.detail(fixtures[0]);
    if (fixture.home.id.startsWith('unresolved') || fixture.away.id.startsWith('unresolved')) return fail('identity not resolved');
    const histories = await source.histories(fixture);
    if (!histories.overall.length) return fail('no H2H rows');
    const completed = await source.detail(histories.overall[0]);
    if (completed.status !== 'finished' || !completed.regular) return fail('historical result not confirmed');
    console.log(`LIVE VERIFIED: ${league.name}, ${fixture.home.name}–${fixture.away.name}; H2H ${histories.overall.length}, venue ${histories.venue.length}, ` +
      `form ${histories.homeForm.length}/${histories.awayForm.length}; first historical FT ${completed.regular.home}:${completed.regular.away}, ` +
      `HT ${completed.firstHalf ? `${completed.firstHalf.home}:${completed.firstHalf.away}` : '—'}; pages ${loader.pages}`);
    app.exit(0);
  } catch (error) {
    fail(error.stack || error.message);
  } finally {
    loader.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
