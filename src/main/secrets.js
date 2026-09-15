// The OpenAI key is encrypted with the operating system's own protection
// (DPAPI on Windows, Keychain on macOS) through Electron safeStorage.
// Only the encrypted blob is written to disk.
'use strict';
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

class SecretStore {
  constructor(root) {
    this.file = path.join(root, 'openai.key');
    fs.mkdirSync(root, { recursive: true });
  }
  available() { return safeStorage.isEncryptionAvailable(); }
  read() {
    if (!fs.existsSync(this.file)) return null;
    if (!this.available()) throw new Error('Zaštićeno skladište ključeva nije dostupno na ovom računaru.');
    try { return safeStorage.decryptString(fs.readFileSync(this.file)); }
    catch { throw new Error('Sačuvani API ključ nije moguće otključati. Unesi ga ponovo.'); }
  }
  save(value) {
    const clean = String(value || '').trim();
    if (!clean) { fs.rmSync(this.file, { force: true }); return; }
    if (!this.available()) throw new Error('Zaštićeno skladište ključeva nije dostupno; ključ nije sačuvan.');
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, safeStorage.encryptString(clean));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { SecretStore };
