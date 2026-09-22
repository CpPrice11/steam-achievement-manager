const assert = require('node:assert/strict');
const test = require('node:test');

const { getAppDetails } = require('../steam/store');

test('Steam Store details use one AppID per request and cache successful responses', async () => {
  const ids = [901001001, 901001002];
  const requested = [];
  const details = await getAppDetails(ids, async (url) => {
    const appId = new URL(url).searchParams.get('appids');
    assert.match(appId, /^\d+$/);
    requested.push(Number(appId));
    return { [appId]: { success: true, data: { name: `Game ${appId}` } } };
  });

  assert.deepEqual(requested.sort(), ids);
  assert.equal(details.get(ids[0]).name, `Game ${ids[0]}`);
  assert.equal(details.get(ids[1]).name, `Game ${ids[1]}`);
  const cached = await getAppDetails(ids, () => { throw new Error('Should not fetch cached details'); });
  assert.equal(cached.size, 2);
});

test('failed Store requests can be retried', async () => {
  const appId = 901001003;
  const failed = await getAppDetails([appId], async () => { throw new Error('offline'); });
  assert.equal(failed.size, 0);
  const retried = await getAppDetails([appId], async () => ({ [appId]: { data: { name: 'Recovered' } } }));
  assert.equal(retried.get(appId).name, 'Recovered');
});
