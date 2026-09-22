const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readInstalledGames } = require('../steam/library');

function appInfoRecord(appId, values) {
  const payload = Buffer.from(`\0${values.join('\0')}\0`, 'utf8');
  const record = Buffer.alloc(12 + payload.length);
  record.writeUInt32LE(appId, 0);
  record.writeUInt32LE(record.length, 4);
  record.writeUInt32LE(2, 8);
  payload.copy(record, 12);
  return record;
}

test('appinfo uses a confirmed game name instead of arbitrary metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'my-sam-library-'));
  try {
    const configDir = path.join(root, 'userdata', '123', 'config');
    const cacheDir = path.join(root, 'appcache');
    await fs.mkdir(path.join(root, 'steamapps'), { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'localconfig.vdf'),
      '"UserLocalConfigStore" { "Software" { "Valve" { "Steam" { "apps" { "1111" {} "2222" {} "3333" {} "4444" {} } } } } }');
    await fs.writeFile(path.join(cacheDir, 'appinfo.vdf'), Buffer.concat([
      appInfoRecord(1111, ['Actual Game Title', 'Game', 'windows,macos,linux']),
      appInfoRecord(2222, ['Unrelated Metadata', 'windows,macos,linux']),
      appInfoRecord(3333, ['windows,macos,linux', 'Game']),
      appInfoRecord(4444, ['2=Rj', 'Game']),
    ]));

    const games = await readInstalledGames([root], { includeLocalConfig: true });
    const names = new Map(games.map((game) => [game.appId, game.name]));
    assert.equal(names.get(1111), 'Actual Game Title');
    assert.equal(names.get(2222), 'App 2222');
    assert.equal(names.get(3333), 'App 3333');
    assert.equal(names.get(4444), 'App 4444');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
