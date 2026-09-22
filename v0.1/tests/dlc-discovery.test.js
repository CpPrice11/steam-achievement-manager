const assert = require('node:assert/strict');
const test = require('node:test');

const { discoverDlcAppIds } = require('../steam/dlc-discovery');

test('a reachable Store with no DLC is not reported as a failure', async () => {
  const result = await discoverDlcAppIds(
    100,
    async () => ({ 100: { success: true, data: {} } }),
    async () => '<html></html>'
  );
  assert.deepEqual(result, { ids: [], warnings: [] });
});

test('failed Store endpoints remain visible when DLC discovery returns no IDs', async () => {
  const result = await discoverDlcAppIds(
    100,
    async () => { throw new Error('HTTP 503'); },
    async () => { throw new Error('offline'); }
  );
  assert.deepEqual(result.ids, []);
  assert.deepEqual(result.warnings, [
    'DLC Store API unavailable: HTTP 503',
    'DLC Store pages unavailable: offline',
  ]);
});

test('a malformed Store response is not mistaken for a game with no DLC', async () => {
  const result = await discoverDlcAppIds(100, async () => ({}), async () => '<html></html>');
  assert.deepEqual(result, {
    ids: [],
    warnings: ['DLC Store API unavailable: Store API response has no AppID entry.'],
  });
});

test('working fallback preserves DLC IDs without a false warning', async () => {
  let apiCalls = 0;
  let pageCalls = 0;
  const result = await discoverDlcAppIds(
    100,
    async () => {
      if (!apiCalls++) throw new Error('HTTP 400');
      return { 100: { data: { dlc: [201, 202] } } };
    },
    async () => {
      if (!pageCalls++) throw new Error('HTTP 404');
      return '<a href="https://store.steampowered.com/app/203/title">DLC</a>';
    }
  );
  assert.deepEqual(result, { ids: [201, 202, 203], warnings: [] });
});
