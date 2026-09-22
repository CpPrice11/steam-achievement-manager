const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAchievementDiff } = require('../domain/achievement-diff');

test('builds before and after values for base-game and DLC achievement changes', () => {
  const achievements = [
    { appId: 100, id: 'BASE_WIN', displayName: 'Base', achieved: false, stateKnown: true },
    { appId: 200, id: 'DLC_WIN', displayName: 'DLC', sourceAppName: 'Expansion', achieved: true, stateKnown: true },
  ];
  const changes = buildAchievementDiff(achievements, new Map([
    ['100:BASE_WIN', true],
    ['200:DLC_WIN', false],
  ]), 100);

  assert.deepEqual(changes, [
    {
      key: '100:BASE_WIN', appId: 100, id: 'BASE_WIN', displayName: 'Base', sourceAppName: '',
      before: false, after: true, achieved: true, action: 'unlock', allowed: true, reason: '',
    },
    {
      key: '200:DLC_WIN', appId: 200, id: 'DLC_WIN', displayName: 'DLC', sourceAppName: 'Expansion',
      before: true, after: false, achieved: false, action: 'lock', allowed: true, reason: '',
    },
  ]);
});

test('blocks missing, unreadable and protected achievements and removes known no-ops', () => {
  const achievements = [
    { appId: 100, id: 'NO_OP', achieved: true, stateKnown: true },
    { appId: 100, id: 'UNKNOWN', achieved: false, stateKnown: false },
    { appId: 100, id: 'PROTECTED', achieved: false, stateKnown: true, changeProtected: true },
  ];
  const changes = buildAchievementDiff(achievements, [
    ['100:NO_OP', true],
    ['100:UNKNOWN', true],
    ['100:PROTECTED', true],
    ['100:MISSING', true],
    ['100:', true],
  ], 100);

  assert.deepEqual(changes.map(({ id, before, allowed, reason }) => ({ id, before, allowed, reason })), [
    { id: 'UNKNOWN', before: null, allowed: false, reason: 'unknown-state' },
    { id: 'PROTECTED', before: false, allowed: false, reason: 'protected' },
    { id: 'MISSING', before: null, allowed: false, reason: 'missing-achievement' },
  ]);
});
