const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { getLocalGameSchema, normalizeStatType } = require('../steam/schema');

test('local schema keeps achievement metadata without forcing hidden state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'my-sam-schema-'));
  const statsDir = path.join(root, 'appcache', 'stats');
  await fs.mkdir(statsDir, { recursive: true });

  const appId = 2400;
  await fs.writeFile(path.join(statsDir, `UserGameStatsSchema_${appId}.bin`), Buffer.from([
    'name', 'ACH_WIN_ONE_GAME',
    'display', 'name', 'english', 'Win One Game',
    'desc', 'english', 'Win one match.',
    'hidden', '0',
    'permission', '1',
    'icon', '1111111111111111111111111111111111111111.jpg',
    'icon_gray', '2222222222222222222222222222222222222222.jpg',
    'name', 'STAT_KILLS',
    'display', 'name', 'english', 'Kills',
    'type', 'type_int',
    'permission', '1',
    'incrementonly', '1',
  ].join('\0'), 'utf8'));

  const schema = await getLocalGameSchema(appId, 'english', [root]);

  assert.equal(schema.status, 'loaded-local');
  assert.equal(schema.achievements[0].name, 'ACH_WIN_ONE_GAME');
  assert.equal(schema.achievements[0].displayName, 'Win One Game');
  assert.equal(schema.achievements[0].hidden, false);
  assert.equal(schema.achievements[0].changeProtected, true);
  assert.deepEqual(schema.stats[0], {
    name: 'STAT_KILLS',
    displayName: 'Kills',
    defaultValue: 0,
    type: 'int',
    incrementOnly: true,
    changeProtected: true,
  });
});

test('local schema preserves Steam float and average-rate stat types', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'my-sam-schema-types-'));
  const statsDir = path.join(root, 'appcache', 'stats');
  await fs.mkdir(statsDir, { recursive: true });

  const appId = 480;
  await fs.writeFile(path.join(statsDir, `UserGameStatsSchema_${appId}.bin`), Buffer.from([
    'name', 'FeetTraveled',
    'display', 'name', 'Total Feet Traveled',
    'type', 'FLOAT',
    'incrementonly', '1',
    'name', 'AverageSpeed',
    'display', 'name', 'Average Speed (f/s)',
    'type', 'AVGRATE',
    'windowsize', '60',
    'name', 'OpaqueStat',
    'display', 'name', 'Opaque Stat',
    'type', 'CUSTOM',
  ].join('\0'), 'utf8'));

  const schema = await getLocalGameSchema(appId, 'english', [root]);

  assert.deepEqual(schema.stats.map(({ name, displayName, type }) => ({ name, displayName, type })), [
    { name: 'FeetTraveled', displayName: 'Total Feet Traveled', type: 'float' },
    { name: 'AverageSpeed', displayName: 'Average Speed (f/s)', type: 'avgrate' },
    { name: 'OpaqueStat', displayName: 'Opaque Stat', type: 'unknown' },
  ]);
});

test('stat type normalization accepts Steam schema aliases', () => {
  assert.equal(normalizeStatType('type_int'), 'int');
  assert.equal(normalizeStatType('FLOAT'), 'float');
  assert.equal(normalizeStatType('AVGRATE'), 'avgrate');
  assert.equal(normalizeStatType('unknown'), 'unknown');
});
