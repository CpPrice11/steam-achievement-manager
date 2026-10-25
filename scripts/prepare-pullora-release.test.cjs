const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareRelease } = require('./prepare-pullora-release.cjs');

function fixture(t, appMachine = 0x8664) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-pullora-test-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(root).startsWith('sam-pullora-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  const exe = Buffer.alloc(256);
  exe.write('MZ');
  exe.writeUInt32LE(0x80, 0x3c);
  exe.write('PE\0\0', 0x80, 'binary');
  exe.writeUInt16LE(0x14c, 0x84);
  for (const [directory, name] of [
    ['Setup', 'Steam Achievement Manager Setup 1.2.3.exe'],
    ['Portable', 'Steam Achievement Manager 1.2.3.exe'],
  ]) {
    fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, directory, name), exe);
    fs.mkdirSync(path.join(root, directory, 'win-unpacked'));
    const app = Buffer.from(exe);
    app.writeUInt16LE(appMachine, 0x84);
    fs.writeFileSync(path.join(root, directory, 'win-unpacked', 'Steam Achievement Manager.exe'), app);
  }
  return root;
}

test('prepares two unambiguous x64 assets and hashes the final copies', async (t) => {
  const root = fixture(t);
  const result = await prepareRelease(root);
  assert.equal(result.version, 'v1.2.3');
  assert.deepEqual(result.files.map((item) => item.name), [
    'SteamAchievementManager-v1.2.3-windows-x64-portable.exe',
    'SteamAchievementManager-v1.2.3-windows-x64-setup.exe',
  ]);
  const sums = fs.readFileSync(path.join(result.output, 'SHA256SUMS.txt'), 'utf8');
  for (const item of result.files) {
    const data = fs.readFileSync(path.join(result.output, item.name));
    assert.equal(item.sha256, crypto.createHash('sha256').update(data).digest('hex'));
    assert.ok(sums.includes(`${item.sha256}  ${item.name}\n`));
  }
  await assert.rejects(prepareRelease(root), /EEXIST/);
});

test('rejects a wrong architecture before creating release output', async (t) => {
  const root = fixture(t, 0x14c);
  await assert.rejects(prepareRelease(root), /Expected an x64 app in Portable/);
  assert.equal(fs.existsSync(path.join(root, 'release-assets')), false);
});

test('rejects missing and ambiguous build outputs', async (t) => {
  const root = fixture(t);
  fs.renameSync(path.join(root, 'Portable', 'Steam Achievement Manager 1.2.3.exe'),
    path.join(root, 'Portable', 'Steam Achievement Manager 1.2.2.exe'));
  await assert.rejects(prepareRelease(root), /Expected one Portable EXE/);
  fs.renameSync(path.join(root, 'Portable', 'Steam Achievement Manager 1.2.2.exe'),
    path.join(root, 'Portable', 'Steam Achievement Manager 1.2.3.exe'));
  fs.copyFileSync(path.join(root, 'Setup', 'Steam Achievement Manager Setup 1.2.3.exe'),
    path.join(root, 'Setup', 'Other 1.2.3.exe'));
  await assert.rejects(prepareRelease(root), /Expected one Setup EXE/);
});
