// Full live report through the Engine, for manual verification:  electron test/live-report.js <dataDir> <leagueID>
'use strict';
const { app } = require('electron');
const path = require('path');
const { LocalStore } = require('../src/main/store.js');
const { Engine } = require('../src/main/engine.js');

const [dataDir, leagueID = 'spain'] = process.argv.slice(2).filter(a => !a.startsWith('-') && !a.endsWith('live-report.js'));
app.whenReady().then(() => {
  const store = new LocalStore(path.join(dataDir, 'data'));
  store.write({ leagueIDs: [leagueID], threshold: 60, theme: 'system', aiBudget: 0.1 }, 'preferences', 'preferences');
  const secrets = { available: () => true, read: () => null, save() {} };
  let last = '';
  const engine = new Engine({ store, secrets, adapterPath: path.join(__dirname, '..', 'resources', 'Flashscore.js'), onChange: () => {
    const s = engine.state;
    const line = `${s.progress} | ${s.report ? `${s.report.completedIDs.length}/${s.report.queue.length} matches, ${s.report.pageCount} pages` : ''}`;
    if (line !== last) { last = line; console.log(new Date().toISOString().slice(11, 19), line); }
    if (!s.isRunning && s.report && s.report.state !== 'U toku') {
      const r = s.report;
      console.log(`DONE state=${r.state} matches=${r.matches.length} findings=${r.matches.reduce((n, m) => n + m.findings.length, 0)} pages=${r.pageCount}`);
      for (const n of r.notes) console.log(`NOTE ${n}`);
      if (s.errorMessage) console.log(`ERROR ${s.errorMessage}`);
      setTimeout(() => app.exit(0), 300);
    }
  } });
  engine.start();
});
