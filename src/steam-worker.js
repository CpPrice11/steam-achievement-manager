let steamworks;

const fs = require('fs');
const os = require('os');
const path = require('path');

function send(ok, resultOrError) {
  if (process.send) {
    process.send(ok ? { ok, result: resultOrError } : { ok, error: resultOrError });
  }
}

function requireSteamworks() {
  if (!steamworks) {
    steamworks = require('steamworks.js');
  }
  return steamworks;
}

function initClient(appId, options = {}) {
  const numericAppId = Number(appId);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0) {
    throw new Error('Invalid AppID.');
  }

  const api = requireSteamworks();
  if (options.initMode === 'appid-file') {
    const workDir = path.join(os.tmpdir(), 'my-sam-steamworks', String(numericAppId));
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'steam_appid.txt'), String(numericAppId));
    process.chdir(workDir);
    return api.init();
  }

  return api.init(numericAppId);
}

function readStat(client, stat) {
  const name = String(stat.name || '');
  if (!name) return null;

  if (stat.type === 'float') {
    return {
      ...stat,
      type: 'float',
      value: null,
      readable: false,
      writable: false,
      error: 'Float stats are not exposed by steamworks.js 0.4.0.',
    };
  }

  try {
    const intValue = client.stats.getInt(name);
    return {
      ...stat,
      type: 'int',
      value: intValue,
      readable: intValue !== null,
      writable: intValue !== null,
      error: intValue === null ? 'Steam did not return this stat value.' : '',
    };
  } catch (error) {
    return { ...stat, type: 'unknown', value: null, readable: false, writable: false, error: error.message };
  }
}

process.on('message', async (payload) => {
  try {
    const client = initClient(payload.appId, { initMode: payload.initMode });

    if (payload.action === 'profile') {
      const steamId = client.localplayer.getSteamId();
      send(true, {
        persona: client.localplayer.getName(),
        steamId64: steamId?.steamId64 ? String(steamId.steamId64) : '',
        steamId32: steamId?.steamId32 || '',
        accountId: steamId?.accountId || 0,
        appId: client.utils.getAppId(),
      });
      return;
    }

    if (payload.action === 'diagnose') {
      send(true, {
        helper: 'steam-worker',
        isolatedProcess: true,
        requestedAppId: Number(payload.appId),
        activeAppId: client.utils.getAppId(),
        installed: client.apps.isAppInstalled(Number(payload.appId)),
        subscribed: client.apps.isSubscribed(),
        appLanguages: client.apps.availableGameLanguages(),
        currentLanguage: client.apps.currentGameLanguage(),
        buildId: client.apps.appBuildId(),
      });
      return;
    }

    if (payload.action === 'achievements') {
      const names = Array.isArray(payload.achievementIds) ? payload.achievementIds : [];
      const achievements = names.map((id) => {
        return {
          id,
          achieved: Boolean(client.achievement.isActivated(id)),
        };
      });
      send(true, achievements);
      return;
    }

    if (payload.action === 'setAchievement') {
      const ok = payload.achieved
        ? client.achievement.activate(payload.id)
        : client.achievement.clear(payload.id);
      if (!ok) throw new Error('Steam rejected the achievement change.');
      const stored = client.stats.store();
      send(true, { id: payload.id, achieved: payload.achieved, stored });
      return;
    }

    if (payload.action === 'setAllAchievements') {
      const names = Array.isArray(payload.achievementIds) ? payload.achievementIds : [];
      const changed = [];
      const failed = [];

      for (const id of names) {
        const ok = payload.achieved
          ? client.achievement.activate(id)
          : client.achievement.clear(id);

        if (ok) {
          changed.push(id);
        } else {
          failed.push(id);
        }
      }

      const stored = changed.length ? client.stats.store() : false;
      send(true, {
        achieved: payload.achieved,
        changed,
        failed,
        stored,
      });
      return;
    }

    if (payload.action === 'setAchievementChanges') {
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      const changed = [];
      const failed = [];

      for (const change of changes) {
        const id = String(change.id || '');
        if (!id) continue;

        const ok = change.achieved
          ? client.achievement.activate(id)
          : client.achievement.clear(id);

        if (ok) {
          changed.push({ id, achieved: Boolean(change.achieved) });
        } else {
          failed.push({ id, achieved: Boolean(change.achieved) });
        }
      }

      const stored = changed.length ? client.stats.store() : false;
      send(true, { changed, failed, stored });
      return;
    }

    if (payload.action === 'readStats') {
      const stats = payload.stats.map((stat) => readStat(client, stat)).filter(Boolean);
      send(true, stats);
      return;
    }

    if (payload.action === 'setStat') {
      if (payload.statType === 'float') {
        throw new Error('Float stats are not supported by steamworks.js 0.4.0.');
      }
      const ok = client.stats.setInt(payload.name, Math.trunc(Number(payload.value)));
      if (!ok) throw new Error('Steam rejected the stat change.');
      const stored = client.stats.store();
      send(true, { name: payload.name, value: payload.value, type: 'int', stored });
      return;
    }

    if (payload.action === 'resetStats') {
      const ok = client.stats.resetAll(false);
      if (!ok) throw new Error('Steam rejected the stat reset.');
      const stored = client.stats.store();
      send(true, { reset: true, stored });
      return;
    }

    throw new Error(`Unknown worker action: ${payload.action}`);
  } catch (error) {
    send(false, error.message || String(error));
  }
});
