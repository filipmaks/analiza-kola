// Builds the portable Windows (x64) app into dist/ from macOS, Linux or Windows.
// Icon and version resources are written with resedit, so no Wine is required.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');
const ResEdit = require('resedit');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const productName = pkg.productName;

async function main() {
  execFileSync(process.execPath, [path.join(__dirname, 'sync-adapter.js')], { stdio: 'inherit' });
  const out = path.join(root, 'dist');
  fs.mkdirSync(out, { recursive: true });
  const [appDir] = await packager({
    dir: root, out, overwrite: true, platform: 'win32', arch: 'x64',
    name: productName, executableName: productName, appVersion: pkg.version, buildVersion: pkg.version,
    appCopyright: 'Fudbalski pregled', asar: true, prune: true, derefSymlinks: true,
    ignore: [/^\/\.gitignore$/, /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/build($|\/)/, /^\/dist($|\/)/, /\.DS_Store$/, /^\/README\.md$/, /^\/package-lock\.json$/]
  });

  const exePath = path.join(appDir, `${productName}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'build', 'icon.ico')));
  for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icon.icons.map(item => item.data));
  }
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  for (const info of ResEdit.Resource.VersionInfo.fromEntries(res.entries)) {
    const langs = info.getAllLanguagesForStringValues();
    info.setFileVersion(major, minor, patch, 0);
    info.setProductVersion(major, minor, patch, 0);
    for (const lang of langs.length ? langs : [{ lang: 1033, codepage: 1200 }]) {
      info.setStringValues(lang, {
        FileDescription: productName, ProductName: productName, CompanyName: 'Fudbalski pregled',
        InternalName: productName, OriginalFilename: `${productName}.exe`, LegalCopyright: 'Fudbalski pregled',
        FileVersion: pkg.version, ProductVersion: pkg.version
      });
    }
    info.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));

  // Chromium only needs these for its own built-in dialogs and falls back to en-US.
  const locales = path.join(appDir, 'locales');
  for (const name of fs.readdirSync(locales)) {
    if (!['en-US.pak', 'sr.pak', 'hr.pak'].includes(name)) fs.rmSync(path.join(locales, name));
  }
  fs.copyFileSync(path.join(root, 'README.md'), path.join(appDir, 'PROCITAJ-ME.md'));
  fs.copyFileSync(path.join(root, 'renderer', 'fonts', 'NOTICE.txt'), path.join(appDir, 'NOTICE-flags.txt'));
  console.log(`Windows aplikacija: ${exePath}`);
}

main().catch(error => { console.error(error); process.exit(1); });
