const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function peMachine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error(`Not a Windows EXE: ${file}`);
    }
    const offset = dos.readUInt32LE(0x3c);
    if (offset < 64 || offset > 1024 * 1024) throw new Error(`Invalid PE header: ${file}`);
    const header = Buffer.alloc(6);
    if (fs.readSync(fd, header, 0, header.length, offset) !== header.length
      || header.toString('binary', 0, 4) !== 'PE\0\0') {
      throw new Error(`Not a Windows EXE: ${file}`);
    }
    return header.readUInt16LE(4);
  } finally {
    fs.closeSync(fd);
  }
}

function builtExe(root, directory, version) {
  const folder = path.join(root, directory);
  const versionPattern = new RegExp(`(^|[^0-9])${version.replaceAll('.', '\\.')}([^0-9]|$)`);
  const names = fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && versionPattern.test(entry.name))
    .map((entry) => entry.name);
  if (names.length !== 1) throw new Error(`Expected one ${directory} EXE for ${version}; found ${names.length}`);
  const file = path.join(folder, names[0]);
  peMachine(file);
  return file;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareRelease(root) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('package.json must have a stable X.Y.Z version');
  }

  const sources = [
    { kind: 'portable', file: builtExe(root, 'Portable', version) },
    { kind: 'setup', file: builtExe(root, 'Setup', version) },
  ];
  for (const directory of ['Portable', 'Setup']) {
    const app = path.join(root, directory, 'win-unpacked', 'Steam Achievement Manager.exe');
    if (peMachine(app) !== 0x8664) throw new Error(`Expected an x64 app in ${directory}`);
  }
  const parent = path.join(root, 'release-assets');
  fs.mkdirSync(parent, { recursive: true });
  const output = path.join(parent, `v${version}`);
  fs.mkdirSync(output);

  const files = [];
  for (const source of sources) {
    const name = `SteamAchievementManager-v${version}-windows-x64-${source.kind}.exe`;
    const file = path.join(output, name);
    fs.copyFileSync(source.file, file, fs.constants.COPYFILE_EXCL);
    files.push({ name, bytes: fs.statSync(file).size, sha256: await sha256(file) });
  }
  const sums = files.map((item) => `${item.sha256}  ${item.name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), sums, { flag: 'wx' });
  return { version: `v${version}`, output, files };
}

if (require.main === module) {
  prepareRelease(path.resolve(__dirname, '..'))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { prepareRelease };
