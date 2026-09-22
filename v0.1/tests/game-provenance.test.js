const assert = require('node:assert/strict');
const test = require('node:test');

const { getGameProvenance } = require('../domain/game-provenance');

test('successful fallback keeps native failure visible as a warning', () => {
  const provenance = getGameProvenance(
    { status: 'loaded-local' },
    {
      status: 'loaded-public',
      sources: ['loaded-public'],
      errors: ['native: Steam API could not initialize'],
      states: new Map([['ACH_WIN', { known: true, achieved: true }]]),
    },
    ['ACH_WIN']
  );

  assert.deepEqual(provenance, {
    source: { schema: 'loaded-local', achievementStates: ['loaded-public'], dlc: [] },
    warnings: ['native: Steam API could not initialize'],
    errors: [],
  });
});

test('unavailable schema and unverified states are reported as errors', () => {
  const provenance = getGameProvenance(
    { status: 'unavailable: HTTP 403' },
    { status: 'partial', sources: [], errors: [], states: new Map([['ACH_WIN', { known: false }]]) },
    ['ACH_WIN']
  );

  assert.deepEqual(provenance.errors, ['schema: unavailable: HTTP 403', 'states: partial']);
});

test('DLC sources and failures stay visible in the parent game diagnostics', () => {
  const loadedDlc = getGameProvenance(
    { status: 'loaded-local' },
    {
      status: 'loaded-public',
      sources: ['loaded-public'],
      errors: ['native: unavailable'],
      states: new Map([['DLC_WIN', { known: true, achieved: false }]]),
    },
    ['DLC_WIN']
  );
  const provenance = getGameProvenance({ status: 'loaded-local' }, null, [], [
    { appId: 111, provenance: loadedDlc },
    { appId: 333, provenance: null },
    {
      appId: 222,
      provenance: {
        source: { schema: 'unavailable', achievementStates: [] },
        warnings: [],
        errors: ['schema read failed'],
      },
    },
  ]);

  assert.deepEqual(provenance.source.dlc, [
    { appId: 111, schema: 'loaded-local', achievementStates: ['loaded-public'] },
    { appId: 222, schema: 'unavailable', achievementStates: [] },
  ]);
  assert.deepEqual(provenance.warnings, ['DLC 111: native: unavailable']);
  assert.deepEqual(provenance.errors, ['DLC 222: schema read failed']);
});
