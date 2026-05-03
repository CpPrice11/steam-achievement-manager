const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { fork, execFile, spawn } = require('child_process');
const fs = require('fs/promises');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { findSteamLibraries, readInstalledGames } = require('./steam-library');
const { getGameSchema, getLocalGameSchema } = require('./schema');
const { getAchievementDlcSource } = require('./dlc-classifier');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: 'Steam Achievement Manager',
    icon: path.join(__dirname, '..', 'assets', 'app-icon.ico'),
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function isSteamRunning() {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        resolve(stdout.toLowerCase().includes('steam.exe'));
      });
    } catch {
      resolve(false);
      return;
    }

    child.on('error', () => {
      resolve(false);
    });
  });
}

function runSteamWorker(payload) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'steam-worker.js');
    const child = fork(workerPath, [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execPath: process.execPath,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    });

    let settled = false;
    let stderr = '';
    const timeoutMs = Number(payload.timeoutMs) > 0
      ? Number(payload.timeoutMs)
      : (payload.action === 'setAllAchievements' || payload.action === 'setAchievementChanges' ? 90000 : 25000);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Steamworks operation timed out.'));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('message', (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      if (message && message.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message?.error || stderr.trim() || 'Steamworks operation failed.'));
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(stderr.trim() || `Steamworks helper exited before replying (${signal || code}).`));
    });

    child.send(payload);
  });
}

function getUnpackedPath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', ...parts);
  }
  return path.join(__dirname, '..', ...parts);
}

function getSteamFlatHelperPath() {
  return getUnpackedPath('helpers', 'steam-flat-helper.ps1');
}

function getSteamApiDllPath() {
  return getUnpackedPath('node_modules', 'steamworks.js', 'dist', 'win64', 'steam_api64.dll');
}

function runSteamFlatHelper(appId, changes) {
  return new Promise((resolve, reject) => {
    const helperPath = getSteamFlatHelperPath();
    const steamApiDll = getSteamApiDllPath();
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      '-AppId',
      String(Number(appId)),
    ], {
      env: {
        ...process.env,
        STEAM_API_DLL: steamApiDll,
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Steam flat helper timed out.'));
    }, 45000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        const jsonLine = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.startsWith('{') && line.endsWith('}'));
        const result = JSON.parse(jsonLine || '{}');
        resolve(result);
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || 'Steam flat helper failed.'));
      }
    });

    child.stdin.end(JSON.stringify(changes));
  });
}

async function readSettings() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return normalizeSettings({});
  }
}

async function writeSettings(settings) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const normalized = normalizeSettings(settings);
  await fs.writeFile(settingsPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

function normalizeSettings(settings) {
  const profiles = settings && typeof settings.profiles === 'object' && settings.profiles
    ? settings.profiles
    : {};

  return {
    apiKey: String(settings?.apiKey || '').trim(),
    language: ['ukrainian', 'english'].includes(settings?.language) ? settings.language : 'ukrainian',
    theme: ['dark', 'light', 'system'].includes(settings?.theme) ? settings.theme : 'dark',
    uiScale: ['compact', 'normal', 'large'].includes(settings?.uiScale) ? settings.uiScale : 'compact',
    gameSort: ['name', 'appid', 'achievements-first', 'risk-first', 'issues-first'].includes(settings?.gameSort) ? settings.gameSort : 'name',
    compact: true,
    profiles,
  };
}

function getProfileSettings(settings, profileId) {
  const normalized = normalizeSettings(settings);
  const profile = profileId ? normalized.profiles[profileId] : null;
  return {
    apiKey: String(profile?.apiKey ?? normalized.apiKey ?? '').trim(),
    language: ['ukrainian', 'english'].includes(profile?.language ?? normalized.language) ? (profile?.language ?? normalized.language) : 'ukrainian',
    theme: ['dark', 'light', 'system'].includes(profile?.theme ?? normalized.theme) ? (profile?.theme ?? normalized.theme) : 'dark',
    uiScale: ['compact', 'normal', 'large'].includes(profile?.uiScale ?? normalized.uiScale) ? (profile?.uiScale ?? normalized.uiScale) : 'compact',
    gameSort: ['name', 'appid', 'achievements-first', 'risk-first', 'issues-first'].includes(profile?.gameSort ?? normalized.gameSort) ? (profile?.gameSort ?? normalized.gameSort) : 'name',
    compact: true,
    profileId: profileId || '',
    persona: String(profile?.persona || ''),
  };
}

async function saveSettingsForProfile(settings) {
  const existing = await readSettings();
  const profileId = String(settings?.profileId || '').trim();
  const next = normalizeSettings(existing);
  const values = {
    apiKey: String(settings?.apiKey || '').trim(),
    language: ['ukrainian', 'english'].includes(settings?.language) ? settings.language : 'ukrainian',
    theme: ['dark', 'light', 'system'].includes(settings?.theme) ? settings.theme : 'dark',
    uiScale: ['compact', 'normal', 'large'].includes(settings?.uiScale) ? settings.uiScale : 'compact',
    gameSort: ['name', 'appid', 'achievements-first', 'risk-first', 'issues-first'].includes(settings?.gameSort) ? settings.gameSort : 'name',
    compact: true,
    persona: String(settings?.persona || ''),
  };

  if (profileId) {
    next.profiles = {
      ...next.profiles,
      [profileId]: values,
    };
  } else {
    next.apiKey = values.apiKey;
    next.language = values.language;
    next.theme = values.theme;
    next.uiScale = values.uiScale;
    next.gameSort = values.gameSort;
    next.compact = true;
  }

  await writeSettings(next);
  return profileId ? { ...values, profileId } : getProfileSettings(next, '');
}

function getHistoryPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function getBackupsDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function safeFilePart(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'game';
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function readHistory() {
  try {
    const raw = await fs.readFile(getHistoryPath(), 'utf8');
    const history = JSON.parse(raw);
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

async function writeHistory(history) {
  const historyPath = getHistoryPath();
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
}

async function appendHistory(entry) {
  const history = await readHistory();
  const next = [{
    ...entry,
    createdAt: new Date().toISOString(),
  }, ...history].slice(0, 200);
  await writeHistory(next);
  return next;
}

async function createAchievementBackup(payload) {
  const game = payload?.game || {};
  const appId = Number(game.appId);
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error('Invalid AppID.');
  }

  const backupsDir = getBackupsDir();
  await fs.mkdir(backupsDir, { recursive: true });
  const fileName = `${timestampForFile()}-${appId}-${safeFilePart(game.name)}.json`;
  const backupPath = path.join(backupsDir, fileName);

  const backup = {
    version: 1,
    createdAt: new Date().toISOString(),
    game: {
      appId,
      name: String(game.name || `App ${appId}`),
    },
    achievements: Array.isArray(payload?.achievements) ? payload.achievements : [],
    pendingChanges: Array.isArray(payload?.changes) ? payload.changes : [],
  };

  await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
  return { path: backupPath };
}

async function readAchievementBackup(backupPath) {
  const resolvedBackupsDir = path.resolve(getBackupsDir());
  const resolvedBackupPath = path.resolve(String(backupPath || ''));
  if (!resolvedBackupPath.startsWith(resolvedBackupsDir + path.sep)) {
    throw new Error('Backup file is outside the app backup folder.');
  }

  const raw = await fs.readFile(resolvedBackupPath, 'utf8');
  const backup = JSON.parse(raw);
  if (!backup || !backup.game || !Array.isArray(backup.achievements)) {
    throw new Error('Backup file is not valid.');
  }

  return {
    ...backup,
    path: resolvedBackupPath,
  };
}

function getSteamId64(profile) {
  const direct = String(profile?.steamId64 || '').trim();
  if (/^\d{16,20}$/.test(direct)) return direct;

  const accountIdText = String(profile?.accountId || profile?.steamId32 || '').trim();
  if (!/^\d+$/.test(accountIdText)) return '';

  const accountId = BigInt(accountIdText);
  if (accountId <= 0n) return '';
  return String(76561197960265728n + accountId);
}

async function getCurrentSteamProfile() {
  if (!await isSteamRunning()) return null;
  try {
    return await runSteamWorker({ action: 'profile', appId: 480 });
  } catch {
    return null;
  }
}

async function readOwnedGamesFromWebApi(apiKey, steamId64) {
  if (!apiKey || !steamId64) return [];

  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId64,
    include_appinfo: '1',
    include_played_free_games: '1',
    format: 'json',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Steam Web API HTTP ${response.status}`);

    const body = await response.json();
    const games = Array.isArray(body?.response?.games) ? body.response.games : [];
    return games
      .map((game) => ({
        appId: Number(game.appid),
        name: String(game.name || '').trim(),
        icon: game.img_icon_url
          ? `https://media.steampowered.com/steamcommunity/public/images/apps/${Number(game.appid)}/${game.img_icon_url}.jpg`
          : '',
        playtimeForever: Number(game.playtime_forever || 0),
        source: 'owned-api',
      }))
      .filter((game) => Number.isInteger(game.appId) && game.appId > 0 && game.name);
  } finally {
    clearTimeout(timeout);
  }
}

function makeAchievementStateFallback(achievementIds) {
  return new Map(achievementIds.map((id) => [String(id), { achieved: false, unlockTime: 0 }]));
}

function normalizeAchievementState(value) {
  if (value && typeof value === 'object') {
    return {
      achieved: Boolean(value.achieved),
      unlockTime: Number(value.unlockTime || value.unlocktime || 0) || 0,
    };
  }
  return { achieved: Boolean(value), unlockTime: 0 };
}

async function readPlayerAchievementStatesFromWebApi(appId, achievementIds, apiKey, steamId64) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];
  const fallback = makeAchievementStateFallback(ids);
  const profileId = String(steamId64 || '').trim();
  if (!ids.length) return { status: 'empty', states: fallback };
  if (!/^\d{16,20}$/.test(profileId)) return { status: 'missing-profile', states: fallback };

  const key = String(apiKey || '').trim();
  const attempts = key ? [key, ''] : [''];

  for (const attemptKey of attempts) {
    const params = new URLSearchParams({
      steamid: profileId,
      appid: String(appId),
      format: 'json',
    });
    if (attemptKey) params.set('key', attemptKey);

    try {
      const body = await fetchJson(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?${params}`, 12000);
      const achievements = Array.isArray(body?.playerstats?.achievements)
        ? body.playerstats.achievements
        : [];
      if (!achievements.length) continue;

      const states = new Map(fallback);
      for (const achievement of achievements) {
        const id = String(achievement.apiname || achievement.name || '').trim();
        if (!id) continue;
        states.set(id, {
          achieved: achievement.achieved === true || Number(achievement.achieved || 0) === 1,
          unlockTime: Number(achievement.unlocktime || achievement.unlockTime || 0) || 0,
        });
      }

      return {
        status: attemptKey ? 'loaded-web-api' : 'loaded-public',
        states,
      };
    } catch {
      // Private profiles and some games reject this endpoint; keep the app read-only instead of starting the game app through Steamworks.
    }
  }

  return { status: 'unavailable', states: fallback };
}

async function readPlayerAchievementStates(appId, achievementIds, apiKey, steamId64, options = {}) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];
  const allowSteamworksFallback = options.allowSteamworksFallback !== false;
  const canUseWebApi = /^\d{16,20}$/.test(String(steamId64 || '').trim());
  const webResult = canUseWebApi
    ? await readPlayerAchievementStatesFromWebApi(appId, ids, apiKey, steamId64)
    : { status: ids.length ? 'skipped-web-api' : 'empty', states: makeAchievementStateFallback(ids) };

  if (!ids.length || webResult.status === 'loaded-web-api' || webResult.status === 'loaded-public') {
    return webResult;
  }
  if (!allowSteamworksFallback) return webResult;

  try {
    const steamworksStates = await runSteamWorker({
      action: 'achievements',
      appId: Number(appId),
      achievementIds: ids,
      timeoutMs: Number(options.timeoutMs || 7000),
    });
    const states = makeAchievementStateFallback(ids);
    for (const achievement of steamworksStates || []) {
      const id = String(achievement?.id || '').trim();
      if (id) {
        states.set(id, {
          achieved: Boolean(achievement.achieved),
          unlockTime: Number(achievement.unlockTime || 0) || 0,
        });
      }
    }
    return {
      status: 'loaded-steamworks-fallback',
      states,
    };
  } catch {
    return webResult;
  }
}

async function applyAchievementChangeGroup(appId, changes, options = {}) {
  return runSteamWorker({
    action: 'setAchievementChanges',
    appId: Number(appId),
    changes,
    initMode: options.initMode || '',
  });
}

function normalizeChangedWithAppId(result, appId) {
  return (result.changed || []).map((change) => ({ ...change, appId }));
}

function normalizeFailedWithAppId(result, appId) {
  return (result.failed || []).map((change) => ({ ...change, appId }));
}

async function applyAchievementChangeGroupWithRetries(appId, changes) {
  let primary;
  try {
    primary = await applyAchievementChangeGroup(appId, changes);
  } catch {
    primary = { changed: [], failed: changes };
  }

  const changed = normalizeChangedWithAppId(primary, appId);
  let failed = normalizeFailedWithAppId(primary, appId);
  if (!failed.length) return { changed, failed };

  try {
    const retry = await applyAchievementChangeGroup(appId, failed, { initMode: 'appid-file' });
    changed.push(...normalizeChangedWithAppId(retry, appId));
    failed = normalizeFailedWithAppId(retry, appId);
  } catch {
    // Keep the original failed list.
  }

  if (!failed.length) return { changed, failed };

  try {
    const flatResult = await runSteamFlatHelper(appId, failed.map((change) => ({
      id: change.id,
      achieved: change.achieved,
    })));
    changed.push(...normalizeChangedWithAppId(flatResult, appId));
    failed = normalizeFailedWithAppId(flatResult, appId);
  } catch {
    // Keep the failed list from steamworks.js if the native flat helper is unavailable.
  }

  return { changed, failed };
}

function isSuspiciousGameName(name, appId = 0) {
  const value = String(name || '').trim();
  if (!value || value === `App ${Number(appId)}`) return true;
  if (value.length < 3) return true;
  if (!/[\p{L}\p{N}]/u.test(value)) return true;
  if ((value.match(/[\p{L}]/gu) || []).length < 2) return true;
  if (/^[^\p{L}\p{N}]*[\p{L}]{1,2}[^\p{L}\p{N}]*$/u.test(value)) return true;
  if (/^[a-zA-Z]{1,3}$/.test(value)) return true;
  if (/^[\W_]+$/.test(value)) return true;
  return false;
}

function getStoreIconFromDetails(appId, details) {
  const icon = String(details?.img_icon_url || '').trim();
  if (/^[a-f0-9]{40}$/i.test(icon)) {
    return `https://media.steampowered.com/steamcommunity/public/images/apps/${Number(appId)}/${icon}.jpg`;
  }

  return String(details?.capsule_imagev5 || details?.capsule_image || details?.header_image || '').trim();
}

async function enrichGameListWithStoreDetails(games) {
  const appIds = games
    .map((game) => Number(game.appId))
    .filter((appId) => Number.isInteger(appId) && appId > 0);
  const details = await getAppDetails(appIds);
  const enriched = [];

  for (const game of games) {
    const appId = Number(game.appId);
    const detail = details.get(appId);
    const type = String(detail?.type || '').toLowerCase();
    if (detail && type && !['game', 'demo'].includes(type)) continue;

    const storeName = String(detail?.name || '').trim();
    const storeIcon = getStoreIconFromDetails(appId, detail);
    enriched.push({
      ...game,
      appId,
      name: storeName && (isSuspiciousGameName(game.name, appId) || game.source === 'localconfig')
        ? storeName
        : (game.name || storeName || `App ${appId}`),
      icon: game.icon || storeIcon || '',
      storeType: type || game.storeType || '',
    });
  }

  return enriched.sort((a, b) => a.name.localeCompare(b.name));
}

function mergeGameLists(localGames, ownedGames) {
  const byAppId = new Map();

  for (const game of localGames) {
    const appId = Number(game.appId);
    if (!Number.isInteger(appId) || appId <= 0) continue;
    byAppId.set(appId, {
      ...game,
      appId,
      source: game.source || 'local',
    });
  }

  for (const game of ownedGames) {
    const appId = Number(game.appId);
    if (!Number.isInteger(appId) || appId <= 0) continue;

    const local = byAppId.get(appId);
    byAppId.set(appId, {
      ...local,
      ...game,
      appId,
      name: game.name || local?.name || `App ${appId}`,
      installDir: local?.installDir || '',
      library: local?.library || '',
      manifestPath: local?.manifestPath || '',
      hasAchievements: Boolean(local?.hasAchievements),
      source: local ? 'owned-api+local' : 'owned-api',
    });
  }

  return [...byAppId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Steam Achievement Manager local desktop app',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Steam Achievement Manager local desktop app',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function getIconCacheDir() {
  return path.join(app.getPath('userData'), 'icon-cache');
}

function getImageExtension(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  return String(url || '').match(/\.(png|webp|jpe?g)(?:$|\?)/i)?.[0].replace('jpeg', 'jpg').split('?')[0] || '.jpg';
}

async function cacheImageUrls(urls) {
  const candidates = Array.isArray(urls) ? urls.map((url) => String(url || '').trim()).filter(Boolean) : [];
  for (const url of candidates) {
    if (url.startsWith('file:')) return { fileUrl: url, source: 'local' };
  }

  await fs.mkdir(getIconCacheDir(), { recursive: true });

  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url)) continue;
    const hash = crypto.createHash('sha1').update(url).digest('hex');
    const existing = ['.jpg', '.png', '.webp'].map((extension) => path.join(getIconCacheDir(), `${hash}${extension}`));
    for (const filePath of existing) {
      try {
        await fs.access(filePath);
        return { fileUrl: pathToFileURL(filePath).toString(), source: 'cache' };
      } catch {
        // Try next cached extension.
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Steam Achievement Manager local desktop app' },
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('image/')) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) continue;
      const filePath = path.join(getIconCacheDir(), `${hash}${getImageExtension(contentType, url)}`);
      await fs.writeFile(filePath, buffer);
      return { fileUrl: pathToFileURL(filePath).toString(), source: 'downloaded' };
    } catch {
      // Try the next CDN candidate.
    }
  }

  return { fileUrl: '', source: 'missing' };
}

function makeGameDiagnostics(game, result) {
  const achievements = Array.isArray(result?.achievements) ? result.achievements : [];
  const protectedCount = achievements.filter((achievement) => achievement.changeProtected).length;
  const dlcCount = achievements.filter((achievement) => achievement.isDlc).length;
  const dlcGroups = new Set();
  for (const achievement of achievements) {
    if (!achievement.isDlc) continue;
    const key = String(achievement.sourceAppName || achievement.sourceAppId || achievement.appId || '').trim();
    if (key) dlcGroups.add(key);
  }

  return {
    appId: Number(game?.appId || 0),
    name: String(game?.name || ''),
    source: String(game?.source || 'local'),
    storeType: String(game?.storeType || ''),
    iconCached: String(game?.icon || '').startsWith('file:'),
    schemaStatus: String(result?.schemaStatus || ''),
    stateStatus: String(result?.stateStatus || ''),
    achievements: achievements.length,
    baseAchievements: achievements.length - dlcCount,
    dlcAchievements: dlcCount,
    dlcCandidates: Number(result?.dlcCount || 0),
    dlcLoaded: Number(result?.dlcAchievementCount || 0),
    dlcGroups: dlcGroups.size,
    protectedAchievements: protectedCount,
    stats: Array.isArray(result?.stats) ? result.stats.length : 0,
    suspiciousName: isSuspiciousGameName(game?.name, game?.appId),
    risky: false,
  };
}

async function diagnoseLibrary() {
  const libraries = await findSteamLibraries();
  const localGames = await readInstalledGames(libraries, { includeLocalConfig: true });
  const games = await withTimeout(enrichGameListWithStoreDetails(localGames), 12000, localGames);
  const rows = [];

  for (const game of games) {
    const schema = await getLocalGameSchema(game.appId, 'english', libraries);
    const achievements = Array.isArray(schema.achievements) ? schema.achievements : [];
    const protectedCount = achievements.filter((achievement) => achievement.changeProtected).length;
    const dlcCount = achievements.filter((achievement) => getAchievementDlcSource(game.appId, achievement)).length;
    rows.push({
      appId: Number(game.appId),
      name: String(game.name || `App ${game.appId}`),
      hasIcon: Boolean(game.icon),
      hasAchievements: achievements.length > 0,
      achievements: achievements.length,
      protectedAchievements: protectedCount,
      dlcAchievements: dlcCount,
      suspiciousName: isSuspiciousGameName(game.name, game.appId),
    });
  }

  return {
    libraries,
    totalGames: rows.length,
    withAchievements: rows.filter((row) => row.hasAchievements).length,
    missingIcons: rows.filter((row) => !row.hasIcon).slice(0, 30),
    suspiciousNames: rows.filter((row) => row.suspiciousName).slice(0, 30),
    protectedGames: rows.filter((row) => row.protectedAchievements > 0).slice(0, 30),
    dlcGames: rows.filter((row) => row.dlcAchievements > 0).slice(0, 30),
  };
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(fallbackValue), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function extractDlcAppIdsFromStoreHtml(html, baseAppId) {
  const ids = new Set();
  const source = String(html || '');
  const patterns = [
    /href="https?:\/\/store\.steampowered\.com\/app\/(\d+)\//gi,
    /data-ds-appid="(\d+)"/gi,
    /data-ds-itemkey="App_(\d+)"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const appId = Number(match[1]);
      if (Number.isInteger(appId) && appId > 0 && appId !== baseAppId) {
        ids.add(appId);
      }
    }
  }

  return [...ids];
}

async function getStoreDlcAppIds(appId) {
  const urls = [
    `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=dlc,basic`,
    `https://store.steampowered.com/api/appdetails?appids=${appId}`,
  ];

  for (const url of urls) {
    try {
      const body = await fetchJson(url);
      const data = body?.[String(appId)]?.data || {};
      const dlc = Array.isArray(data.dlc) ? data.dlc : [];
      if (dlc.length) {
        return dlc
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0);
      }
    } catch {
      // Try the next public Store endpoint shape.
    }
  }

  return [];
}

async function getStoreDlcPageAppIds(appId) {
  const pages = [
    `https://store.steampowered.com/dlc/${appId}/?l=english`,
    `https://store.steampowered.com/app/${appId}/?l=english`,
  ];

  const ids = new Set();
  for (const page of pages) {
    try {
      for (const dlcAppId of extractDlcAppIdsFromStoreHtml(await fetchText(page), appId)) {
        ids.add(dlcAppId);
      }
    } catch {
      // Some games have no DLC page, or Steam can block the page temporarily.
    }
  }

  return [...ids];
}

async function getGameDlcAppIds(appId) {
  const ids = new Set();

  for (const dlcAppId of await getStoreDlcAppIds(appId)) {
    ids.add(dlcAppId);
  }

  for (const dlcAppId of await getStoreDlcPageAppIds(appId)) {
    ids.add(dlcAppId);
  }

  return [...ids].slice(0, 250);
}

async function getAppDetails(appIds) {
  const details = new Map();
  if (!appIds.length) return new Map();

  const chunkSize = 50;
  for (let index = 0; index < appIds.length; index += chunkSize) {
    const chunk = appIds.slice(index, index + chunkSize);
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${chunk.join(',')}&filters=basic`;
      const body = await fetchJson(url);
      for (const appId of chunk) {
        const data = body?.[String(appId)]?.data;
        if (data) details.set(appId, data);
      }
    } catch {
      // Keep any details gathered from earlier chunks.
    }
  }

  return details;
}

async function getValidatedDlcDetails(baseAppId, appIds) {
  const rawDetails = await getAppDetails(appIds);
  const details = new Map();

  for (const appId of appIds) {
    const data = rawDetails.get(appId);
    if (!data) continue;

    const type = String(data.type || '').toLowerCase();
    const fullgameAppId = Number(data.fullgame?.appid || data.fullgame?.appId || 0);
    if (type !== 'dlc') continue;
    if (Number.isInteger(fullgameAppId) && fullgameAppId > 0 && fullgameAppId !== Number(baseAppId)) continue;

    details.set(appId, data);
  }

  return details;
}

async function getDlcNames(appIds) {
  if (!appIds.length) return new Map();
  try {
    const details = await getAppDetails(appIds);
    const names = new Map();
    for (const appId of appIds) {
      const name = details.get(appId)?.name;
      if (name) names.set(appId, String(name));
    }
    return names;
  } catch {
    return new Map();
  }
}

ipcMain.handle('app:getStatus', async () => {
  const steamRunning = await isSteamRunning();
  const libraries = await findSteamLibraries();
  const allSettings = await readSettings();
  let profile = null;

  if (steamRunning) {
    try {
      profile = await runSteamWorker({ action: 'profile', appId: 480 });
    } catch (error) {
      profile = { error: error.message };
    }
  }

  return {
    steamRunning,
    libraries,
    settings: getProfileSettings(allSettings, getSteamId64(profile)),
    profile,
  };
});

ipcMain.handle('app:listGames', async (_event, payload = {}) => {
  const libraries = await findSteamLibraries();
  const localGames = await readInstalledGames(libraries, { includeLocalConfig: true });
  const settings = await readSettings();
  const apiKey = String(payload?.apiKey || settings.apiKey || '').trim();
  const enrichedLocalGames = await withTimeout(enrichGameListWithStoreDetails(localGames), 12000, localGames);
  if (!apiKey) return enrichedLocalGames;

  const profile = await getCurrentSteamProfile();
  const steamId64 = getSteamId64(profile);
  if (!steamId64) return enrichedLocalGames;

  try {
    const ownedGames = await readOwnedGamesFromWebApi(apiKey, steamId64);
    return await withTimeout(enrichGameListWithStoreDetails(mergeGameLists(enrichedLocalGames, ownedGames)), 12000, mergeGameLists(enrichedLocalGames, ownedGames));
  } catch {
    return enrichedLocalGames;
  }
});

ipcMain.handle('app:saveSettings', async (_event, settings) => {
  return saveSettingsForProfile(settings);
});

ipcMain.handle('app:getHistory', async () => {
  return readHistory();
});

ipcMain.handle('app:createAchievementBackup', async (_event, payload) => {
  return createAchievementBackup(payload);
});

ipcMain.handle('app:readAchievementBackup', async (_event, backupPath) => {
  return readAchievementBackup(backupPath);
});

ipcMain.handle('app:openBackupsFolder', async () => {
  const backupsDir = getBackupsDir();
  await fs.mkdir(backupsDir, { recursive: true });
  const result = await shell.openPath(backupsDir);
  if (result) throw new Error(result);
  return true;
});

ipcMain.handle('app:recordHistory', async (_event, entry) => {
  return appendHistory({
    game: entry?.game || {},
    changes: Array.isArray(entry?.changes) ? entry.changes : [],
    changed: Array.isArray(entry?.changed) ? entry.changed : [],
    failed: Array.isArray(entry?.failed) ? entry.failed : [],
    backupPath: String(entry?.backupPath || ''),
  });
});

ipcMain.handle('app:openSteamPage', async (_event, appId) => {
  const numericAppId = Number(appId);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0) {
    throw new Error('Invalid AppID.');
  }

  await shell.openExternal(`https://store.steampowered.com/app/${numericAppId}`);
  return true;
});

ipcMain.handle('app:cacheImage', async (_event, urls) => {
  return cacheImageUrls(urls);
});

ipcMain.handle('app:diagnoseLibrary', async () => {
  return diagnoseLibrary();
});

ipcMain.handle('game:load', async (_event, { appId, apiKey, language, steamId64 }) => {
  const numericAppId = Number(appId);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0) {
    throw new Error('Invalid AppID.');
  }

  const libraries = await findSteamLibraries();
  const schema = await getGameSchema(numericAppId, apiKey, language, libraries);
  const baseAchievementIds = (schema.achievements || []).map((achievement) => achievement.name);
  const steamId = String(steamId64 || '').trim();
  const baseStates = await readPlayerAchievementStates(numericAppId, baseAchievementIds, apiKey, steamId);
  const baseAchievements = baseAchievementIds.map((id) => {
    const state = normalizeAchievementState(baseStates.states.get(id));
    return {
      id,
      achieved: state.achieved,
      unlockTime: state.unlockTime,
    };
  });

  const schemaAchievements = new Map((schema.achievements || []).map((item) => [item.name, item]));
  const mergedAchievements = baseAchievements.map((achievement) => {
    const meta = schemaAchievements.get(achievement.id) || {};
    const dlcSource = getAchievementDlcSource(numericAppId, { ...achievement, ...meta });
    return {
      ...achievement,
      appId: numericAppId,
      sourceAppId: numericAppId,
      sourceAppName: dlcSource,
      isDlc: Boolean(dlcSource),
      displayName: meta.displayName || achievement.id,
      description: meta.description || '',
      hidden: Boolean(meta.hidden),
      changeProtected: Boolean(meta.changeProtected),
      icon: meta.icon || '',
      iconGray: meta.iconGray || '',
    };
  });

  const dlcCandidates = await withTimeout(getGameDlcAppIds(numericAppId), 7000, []);
  const dlcDetails = await withTimeout(getValidatedDlcDetails(numericAppId, dlcCandidates), 7000, new Map());
  const dlcAppIds = [...dlcDetails.keys()];
  const dlcAchievements = [];
  const baseAchievementIdSet = new Set(baseAchievementIds);

  for (const dlcAppId of dlcAppIds) {
    try {
      const dlcSchema = await getGameSchema(dlcAppId, apiKey, language, libraries);
      const dlcIds = (dlcSchema.achievements || []).map((achievement) => achievement.name);
      if (!dlcIds.length) continue;
      if (dlcIds.every((id) => baseAchievementIdSet.has(id))) continue;

      const dlcStates = await readPlayerAchievementStates(dlcAppId, dlcIds, apiKey, steamId, {
        allowSteamworksFallback: false,
      });
      const states = dlcIds.map((id) => {
        const state = normalizeAchievementState(dlcStates.states.get(id));
        return {
          id,
          achieved: state.achieved,
          unlockTime: state.unlockTime,
        };
      });

      const dlcSchemaById = new Map((dlcSchema.achievements || []).map((item) => [item.name, item]));
      for (const achievement of states) {
        const meta = dlcSchemaById.get(achievement.id) || {};
        dlcAchievements.push({
          ...achievement,
          appId: dlcAppId,
          sourceAppId: dlcAppId,
          sourceAppName: dlcDetails.get(dlcAppId)?.name || `DLC ${dlcAppId}`,
          isDlc: true,
          displayName: meta.displayName || achievement.id,
          description: meta.description || '',
          hidden: Boolean(meta.hidden),
          changeProtected: Boolean(meta.changeProtected),
          icon: meta.icon || '',
          iconGray: meta.iconGray || '',
        });
      }
    } catch {
      // DLC schema availability varies a lot between games.
    }
  }

  const result = {
    schemaStatus: schema.status,
    stateStatus: baseStates.status,
    achievements: [...mergedAchievements, ...dlcAchievements],
    stats: schema.stats || [],
    dlcCount: dlcCandidates.length,
    dlcAchievementCount: dlcAchievements.length,
  };
  result.diagnostics = makeGameDiagnostics({ appId: numericAppId }, result);
  return result;
});

ipcMain.handle('achievement:set', async (_event, { appId, id, achieved }) => {
  return runSteamWorker({
    action: 'setAchievement',
    appId: Number(appId),
    id: String(id),
    achieved: Boolean(achieved),
  });
});

ipcMain.handle('achievement:setAll', async (_event, { appId, achievementIds, achieved }) => {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];

  if (!ids.length) {
    throw new Error('No achievements are available for this game.');
  }

  return runSteamWorker({
    action: 'setAllAchievements',
    appId: Number(appId),
    achievementIds: ids,
    achieved: Boolean(achieved),
  });
});

ipcMain.handle('achievement:applyChanges', async (_event, { appId, changes }) => {
  const normalizedChanges = Array.isArray(changes)
    ? changes
      .map((change) => ({
        appId: Number(change?.appId || appId),
        id: String(change?.id || ''),
        achieved: Boolean(change?.achieved),
      }))
      .filter((change) => change.id)
    : [];

  if (!normalizedChanges.length) {
    throw new Error('No achievement changes are waiting for confirmation.');
  }

  const groups = new Map();
  for (const change of normalizedChanges) {
    if (!Number.isInteger(change.appId) || change.appId <= 0) continue;
    if (!groups.has(change.appId)) groups.set(change.appId, []);
    groups.get(change.appId).push({ id: change.id, achieved: change.achieved });
  }

  const changed = [];
  const failed = [];
  const baseAppId = Number(appId);
  for (const [groupAppId, groupChanges] of groups) {
    const result = await applyAchievementChangeGroupWithRetries(groupAppId, groupChanges);
    changed.push(...result.changed);

    if (result.failed.length && Number.isInteger(baseAppId) && baseAppId > 0 && groupAppId !== baseAppId) {
      const fallback = await applyAchievementChangeGroupWithRetries(baseAppId, result.failed);
      changed.push(...fallback.changed.map((change) => ({ ...change, appId: groupAppId })));
      failed.push(...fallback.failed.map((change) => ({ ...change, appId: groupAppId })));
    } else {
      failed.push(...result.failed);
    }

    if (!result.failed.length && groupAppId !== baseAppId) {
      for (const change of result.changed) {
        change.appId = groupAppId;
      }
    }
  }

  return { changed, failed, stored: changed.length > 0 };
});

ipcMain.handle('stats:read', async (_event, { appId, stats }) => {
  return runSteamWorker({
    action: 'readStats',
    appId: Number(appId),
    stats: Array.isArray(stats) ? stats : [],
  });
});

ipcMain.handle('stats:set', async (_event, { appId, name, type, value }) => {
  return runSteamWorker({
    action: 'setStat',
    appId: Number(appId),
    name: String(name),
    statType: type === 'float' ? 'float' : 'int',
    value: Number(value),
  });
});

ipcMain.handle('stats:reset', async (_event, { appId }) => {
  return runSteamWorker({
    action: 'resetStats',
    appId: Number(appId),
  });
});

ipcMain.handle('steamworks:diagnose', async (_event, { appId }) => {
  return runSteamWorker({
    action: 'diagnose',
    appId: Number(appId),
    timeoutMs: 7000,
  });
});
