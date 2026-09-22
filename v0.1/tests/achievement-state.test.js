const assert = require('assert/strict');
const test = require('node:test');

const {
  makeAchievementStateFallback,
  mergeKnownAchievementStates,
  countKnownAchievementStates,
  normalizeAchievementState,
} = require('../domain/achievement-state');

test('partial Steam state keeps unreadable achievements unknown until another source confirms them', () => {
  const states = makeAchievementStateFallback(['A', 'B']);
  mergeKnownAchievementStates(states, new Map([
    ['A', { achieved: true, unlockTime: 123, known: true }],
    ['B', { unlockTime: 0, known: true }],
    ['OTHER', { achieved: true, unlockTime: 456, known: true }],
  ]));

  assert.equal(countKnownAchievementStates(states), 1);
  assert.deepEqual(normalizeAchievementState(states.get('B')), {
    achieved: false, unlockTime: 0, known: false,
  });
  assert.equal(states.has('OTHER'), false);

  mergeKnownAchievementStates(states, new Map([
    ['A', { achieved: false, unlockTime: 0, known: true }],
    ['B', { achieved: false, unlockTime: 0, known: true }],
  ]));

  assert.equal(countKnownAchievementStates(states), 2);
  assert.deepEqual(normalizeAchievementState(states.get('A')), {
    achieved: true, unlockTime: 123, known: true,
  });
  assert.deepEqual(normalizeAchievementState(states.get('B')), {
    achieved: false, unlockTime: 0, known: true,
  });
});
