const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { getLocalGameSchema } = require('../schema');

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
    'icon', '1111111111111111111111111111111111111111.jpg',
    'icon_gray', '2222222222222222222222222222222222222222.jpg',
  ].join('\0'), 'utf8'));

  const schema = await getLocalGameSchema(appId, 'english', [root]);

  assert.equal(schema.status, 'loaded-local');
  assert.equal(schema.achievements[0].name, 'ACH_WIN_ONE_GAME');
  assert.equal(schema.achievements[0].displayName, 'Win One Game');
  assert.equal(schema.achievements[0].hidden, false);
});
