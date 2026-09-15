// Copies the shared Flashscore adapter and captured test fixtures from the macOS
// sources, so both apps always run the exact same DOM extractor.
'use strict';
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..');
const adapter = path.join(repo, 'Sources', 'FootballApp', 'Resources', 'Flashscore.js');
const fixtures = path.join(repo, 'Tests', 'FootballCoreTests', 'Fixtures');
const here = path.resolve(__dirname, '..');

if (!fs.existsSync(adapter)) {
  console.log('Shared sources not found next to this folder; keeping the bundled copies.');
  process.exit(0);
}
fs.mkdirSync(path.join(here, 'resources'), { recursive: true });
fs.copyFileSync(adapter, path.join(here, 'resources', 'Flashscore.js'));
fs.mkdirSync(path.join(here, 'test', 'fixtures'), { recursive: true });
for (const name of fs.readdirSync(fixtures)) {
  if (name.endsWith('.json') || name === 'today.html') fs.copyFileSync(path.join(fixtures, name), path.join(here, 'test', 'fixtures', name));
}
console.log('Adapter and fixtures synced.');
