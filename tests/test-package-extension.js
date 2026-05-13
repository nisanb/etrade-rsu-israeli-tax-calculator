// Run: node tests/test-package-extension.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-rsu-package-'));
const srcDir = path.join(tmpDir, 'src');
const outFile = path.join(tmpDir, 'extension.zip');
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(path.join(srcDir, 'icons'), { recursive: true });
fs.mkdirSync(path.join(srcDir, 'tests'), { recursive: true });
fs.mkdirSync(path.join(srcDir, 'docs'), { recursive: true });

fs.writeFileSync(path.join(srcDir, 'manifest.json'), '{"manifest_version":3,"name":"x","version":"1.0.0"}');
fs.writeFileSync(path.join(srcDir, 'content.js'), 'console.log("hi");');
fs.writeFileSync(path.join(srcDir, 'popup.html'), '<html></html>');
fs.writeFileSync(path.join(srcDir, 'icons', 'icon128.png'), 'icon');
fs.writeFileSync(path.join(srcDir, 'README.md'), 'docs');
fs.writeFileSync(path.join(srcDir, 'AGENTS.md'), 'agent');
fs.writeFileSync(path.join(srcDir, 'tests', 'ignored.js'), 'ignored');
fs.writeFileSync(path.join(srcDir, 'docs', 'ignored.md'), 'ignored');
fs.writeFileSync(path.join(srcDir, 'logo.png:Zone.Identifier'), 'ignored');

execFileSync('python3', [
  'scripts/package_extension.py',
  '--source',
  srcDir,
  '--output',
  outFile,
], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'pipe',
});

const archiveList = execFileSync('python3', [
  '-c',
  [
    'import json, sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as zf:',
    '    print(json.dumps(sorted(zf.namelist())))',
  ].join('\n'),
  outFile,
], {
  encoding: 'utf8',
}).trim();

const names = JSON.parse(archiveList);

assert.deepStrictEqual(names, [
  'content.js',
  'icons/icon128.png',
  'manifest.json',
  'popup.html',
]);

console.log('package_extension.py includes only shippable extension files');
