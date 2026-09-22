function makeAchievementStateFallback(ids) {
  return new Map(ids.map((id) => [String(id), { achieved: false, unlockTime: 0, known: false }]));
}

function mergeKnownAchievementStates(target, source) {
  for (const [id, value] of source) {
    if (target.has(id) && !target.get(id).known && value?.known && typeof value.achieved === 'boolean') {
      target.set(id, value);
    }
  }
  return target;
}

function countKnownAchievementStates(states) {
  return [...states.values()].filter((value) => value.known).length;
}

function normalizeAchievementState(value) {
  if (!value?.known || typeof value.achieved !== 'boolean') {
    return { achieved: false, unlockTime: 0, known: false };
  }
  return {
    achieved: Boolean(value.achieved),
    unlockTime: Number(value.unlockTime || value.unlocktime || 0) || 0,
    known: true,
  };
}

module.exports = {
  makeAchievementStateFallback,
  mergeKnownAchievementStates,
  countKnownAchievementStates,
  normalizeAchievementState,
};
