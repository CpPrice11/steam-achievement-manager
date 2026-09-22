(function exposeAchievementDiff(root) {
  function getAppId(achievement, fallbackAppId) {
    const appId = Number(achievement?.appId || achievement?.sourceAppId || fallbackAppId || 0);
    return Number.isInteger(appId) && appId > 0 ? appId : 0;
  }

  function getAchievementKey(achievement, fallbackAppId) {
    const appId = getAppId(achievement, fallbackAppId);
    const id = String(achievement?.id || '').trim();
    return appId && id ? `${appId}:${id}` : '';
  }

  function parseChangeKey(value, fallbackAppId) {
    const key = String(value || '');
    const separator = key.indexOf(':');
    const appId = Number(separator >= 0 ? key.slice(0, separator) : fallbackAppId || 0);
    const id = String(separator >= 0 ? key.slice(separator + 1) : key).trim();
    return Number.isInteger(appId) && appId > 0 && id ? { appId, id, key: `${appId}:${id}` } : null;
  }

  function buildAchievementDiff(achievements = [], pendingChanges = [], fallbackAppId = 0) {
    const achievementByKey = new Map();
    for (const achievement of achievements) {
      const key = getAchievementKey(achievement, fallbackAppId);
      if (key) achievementByKey.set(key, achievement);
    }

    return [...pendingChanges]
      .map(([pendingKey, nextAchieved]) => {
        const parsed = parseChangeKey(pendingKey, fallbackAppId);
        if (!parsed) return null;

        const achievement = achievementByKey.get(parsed.key);
        const appId = getAppId(achievement, parsed.appId);
        const id = String(achievement?.id || parsed.id).trim();
        if (!appId || !id) return null;

        const stateKnown = Boolean(achievement) && achievement.stateKnown !== false;
        const changeProtected = Boolean(achievement?.changeProtected);
        const before = stateKnown ? Boolean(achievement.achieved) : null;
        const achieved = Boolean(nextAchieved);
        let reason = '';
        if (!achievement) reason = 'missing-achievement';
        else if (!stateKnown) reason = 'unknown-state';
        else if (changeProtected) reason = 'protected';

        return {
          key: `${appId}:${id}`,
          appId,
          id,
          displayName: achievement?.displayName || id,
          sourceAppName: achievement?.sourceAppName || '',
          before,
          after: achieved,
          achieved,
          action: achieved ? 'unlock' : 'lock',
          allowed: !reason,
          reason,
        };
      })
      .filter((change) => change && (change.before === null || change.before !== change.after));
  }

  const api = { buildAchievementDiff };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AchievementDiff = api;
})(globalThis);
