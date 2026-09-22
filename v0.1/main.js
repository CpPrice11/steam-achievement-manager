const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { fork, execFile, spawn } = require('child_process');
const fs = require('fs/promises');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { findSteamRoot, findSteamLibraries, readInstalledGames } = require('./steam/library');
const { getAppDetails } = require('./steam/store');
const { discoverDlcAppIds } = require('./steam/dlc-discovery');
const { getGameSchema, getLocalGameSchema, normalizeStatType } = require('./steam/schema');
const { getGameProvenance } = require('./domain/game-provenance');
const { getAchievementDlcSource } = require('./domain/dlc-classifier');
const {
  makeAchievementStateFallback,
  mergeKnownAchievementStates,
  countKnownAchievementStates,
  normalizeAchievementState,
} = require('./domain/achievement-state');

const ALLOWED_LANGUAGES = ['ukrainian', 'english'];
const ALLOWED_THEMES = ['dark', 'light', 'system'];
const ALLOWED_UI_SCALES = ['compact', 'normal', 'large'];
const ALLOWED_GAME_SORTS = ['name', 'appid', 'achievements-first', 'risk-first', 'issues-first'];
const NON_GAME_STORE_TYPES = new Set(['dlc', 'music', 'video', 'episode', 'series', 'advertising', 'config']);

app.disableHardwareAcceleration();

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

let mainWindow;
const protectedAchievementsByAppId = new Map();
const statsByAppId = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: 'Steam Achievement Manager',
    icon: path.join(__dirname, 'assets', 'app-icon-pullora.ico'),
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
    const workerPath = getUnpackedPath('v0.1', 'steam', 'worker.js');
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
      : (payload.action === 'setAchievementChanges' ? 90000 : 25000);
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

const appRoot = path.join(__dirname, '..');

function getUnpackedPath(...parts) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', ...parts);
  }
  return path.join(appRoot, ...parts);
}

function getSteamFlatHelperPath() {
  return getUnpackedPath('v0.1', 'steam', 'helpers', 'steam-flat-helper.ps1');
}

function getSteamApiDllPath() {
  return getUnpackedPath('node_modules', 'steamworks.js', 'dist', 'win64', 'steam_api64.dll');
}

async function runSteamFlatHelper(appId, input = [], action = 'apply', options = {}) {
  const steamInstallPath = await findSteamRoot();
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
      '-Action',
      action,
    ], {
      env: {
        ...process.env,
        STEAM_API_DLL: steamApiDll,
        STEAM_INSTALL_PATH: steamInstallPath,
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
    }, Number(options.timeoutMs || 45000));

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
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        resolve(result);
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || 'Steam flat helper failed.'));
      }
    });

    child.stdin.end(JSON.stringify(input));
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
    language: pickAllowed(settings?.language, ALLOWED_LANGUAGES, 'ukrainian'),
    theme: pickAllowed(settings?.theme, ALLOWED_THEMES, 'dark'),
    uiScale: pickAllowed(settings?.uiScale, ALLOWED_UI_SCALES, 'compact'),
    gameSort: pickAllowed(settings?.gameSort, ALLOWED_GAME_SORTS, 'name'),
    profiles,
  };
}

function getProfileSettings(settings, profileId) {
  const normalized = normalizeSettings(settings);
  const profile = profileId ? normalized.profiles[profileId] : null;
  return {
    apiKey: String(profile?.apiKey ?? normalized.apiKey ?? '').trim(),
    language: pickAllowed(profile?.language ?? normalized.language, ALLOWED_LANGUAGES, 'ukrainian'),
    theme: pickAllowed(profile?.theme ?? normalized.theme, ALLOWED_THEMES, 'dark'),
    uiScale: pickAllowed(profile?.uiScale ?? normalized.uiScale, ALLOWED_UI_SCALES, 'compact'),
    gameSort: pickAllowed(profile?.gameSort ?? normalized.gameSort, ALLOWED_GAME_SORTS, 'name'),
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
    language: pickAllowed(settings?.language, ALLOWED_LANGUAGES, 'ukrainian'),
    theme: pickAllowed(settings?.theme, ALLOWED_THEMES, 'dark'),
    uiScale: pickAllowed(settings?.uiScale, ALLOWED_UI_SCALES, 'compact'),
    gameSort: pickAllowed(settings?.gameSort, ALLOWED_GAME_SORTS, 'name'),
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

async function readPlayerAchievementStatesFromWebApi(appId, achievementIds, apiKey, steamId64) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];
  const wanted = new Set(ids);
  const fallback = makeAchievementStateFallback(ids);
  const profileId = String(steamId64 || '').trim();
  if (!ids.length) return { status: 'empty', states: fallback };
  if (!/^\d{16,20}$/.test(profileId)) return { status: 'missing-profile', states: fallback };

  const key = String(apiKey || '').trim();
  const attempts = key ? [key, ''] : [''];
  const combined = makeAchievementStateFallback(ids);
  let sourceStatus = '';
  let returnedCount = 0;

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

      const states = makeAchievementStateFallback(ids);
      for (const achievement of achievements) {
        const id = String(achievement.apiname || achievement.name || '').trim();
        if (!wanted.has(id) || ![true, false, 0, 1, '0', '1'].includes(achievement.achieved)) continue;
        states.set(id, {
          achieved: achievement.achieved === true || Number(achievement.achieved || 0) === 1,
          unlockTime: Number(achievement.unlocktime || achievement.unlockTime || 0) || 0,
          known: true,
        });
      }

      if (!countKnownAchievementStates(states)) continue;
      mergeKnownAchievementStates(combined, states);
      sourceStatus = sourceStatus || (attemptKey ? 'loaded-web-api' : 'loaded-public');
      returnedCount = Math.max(returnedCount, achievements.length);
      const matchedCount = countKnownAchievementStates(combined);
      if (matchedCount === ids.length) {
        return { status: sourceStatus, states: combined, matchedCount, returnedCount };
      }
    } catch {
      // Private profiles and some games reject this endpoint; keep the app read-only instead of starting the game app through Steamworks.
    }
  }

  const matchedCount = countKnownAchievementStates(combined);
  return matchedCount
    ? { status: 'partial-web-api', states: combined, matchedCount, returnedCount }
    : { status: 'unavailable', states: fallback, matchedCount: 0, returnedCount: 0 };
}

async function readPlayerAchievementStatesFromNative(appId, achievementIds, options = {}) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];
  const states = makeAchievementStateFallback(ids);
  if (!ids.length) return { status: 'empty', states };

  const result = await runSteamFlatHelper(appId, ids, 'states', {
    timeoutMs: Number(options.timeoutMs || 30000),
  });
  const wanted = new Set(ids);
  for (const achievement of result.achievements || []) {
    const id = String(achievement?.id || '').trim();
    if (!wanted.has(id) || achievement.error || typeof achievement.achieved !== 'boolean') continue;
    states.set(id, {
      achieved: Boolean(achievement.achieved),
      unlockTime: Number(achievement.unlockTime || 0) || 0,
      known: true,
    });
  }

  const readable = countKnownAchievementStates(states);
  if (!readable) {
    throw new Error('Steam did not return achievement states for this app.');
  }

  return {
    status: readable === ids.length ? 'loaded-native' : 'partial-native',
    states,
    nativeReadCount: readable,
    nativeReturnedCount: (result.achievements || []).length,
  };
}

async function readPlayerAchievementStatesFromSteamworks(appId, achievementIds, options = {}) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];
  const steamworksStates = await runSteamWorker({
    action: 'achievements',
    appId: Number(appId),
    achievementIds: ids,
    timeoutMs: Number(options.timeoutMs || 7000),
  });
  const states = makeAchievementStateFallback(ids);
  for (const achievement of steamworksStates || []) {
    const id = String(achievement?.id || '').trim();
    if (states.has(id) && achievement.achieved === true) {
      states.set(id, {
        achieved: true,
        unlockTime: Number(achievement.unlockTime || 0) || 0,
        known: true,
      });
    }
  }
  return {
    status: countKnownAchievementStates(states) === ids.length ? 'loaded-steamworks-fallback' : 'partial-steamworks',
    states,
  };
}

async function readPlayerAchievementStates(appId, achievementIds, apiKey, steamId64, options = {}) {
  const ids = Array.isArray(achievementIds)
    ? achievementIds.map((id) => String(id)).filter(Boolean)
    : [];
  if (!ids.length) return { status: 'empty', states: makeAchievementStateFallback(ids) };

  const preferNative = options.preferNative !== false;
  const allowSteamworksFallback = options.allowSteamworksFallback !== false;
  const errors = [];
  const states = makeAchievementStateFallback(ids);
  const sources = [];
  const addResult = (result) => {
    const before = countKnownAchievementStates(states);
    mergeKnownAchievementStates(states, result.states);
    if (countKnownAchievementStates(states) > before) sources.push(result.status);
  };

  if (preferNative) {
    try {
      addResult(await readPlayerAchievementStatesFromNative(appId, ids, options));
      if (countKnownAchievementStates(states) === ids.length) {
        return { status: 'loaded-native', states, errors, sources };
      }
    } catch (error) {
      errors.push(`native: ${error.message}`);
    }
  }

  if (allowSteamworksFallback) {
    try {
      addResult(await readPlayerAchievementStatesFromSteamworks(appId, ids, options));
      if (countKnownAchievementStates(states) === ids.length) {
        return { status: sources.length > 1 ? 'loaded-mixed' : 'loaded-steamworks-fallback', states, errors, sources };
      }
    } catch (error) {
      errors.push(`steamworks: ${error.message}`);
    }
  }

  const canUseWebApi = /^\d{16,20}$/.test(String(steamId64 || '').trim());
  const webResult = canUseWebApi
    ? await readPlayerAchievementStatesFromWebApi(appId, ids, apiKey, steamId64)
    : { status: ids.length ? 'skipped-web-api' : 'empty', states: makeAchievementStateFallback(ids) };
  addResult(webResult);
  const knownCount = countKnownAchievementStates(states);

  return {
    status: knownCount === ids.length
      ? (sources.length > 1 ? 'loaded-mixed' : webResult.status)
      : (knownCount ? 'partial' : webResult.status),
    states,
    errors,
    sources,
    knownCount,
  };
}

async function applyAchievementChangeGroup(appId, changes, options = {}) {
  return runSteamWorker({
    action: 'setAchievementChanges',
    appId: Number(appId),
    changes,
    initMode: options.initMode || '',
  });
}

function withAppId(items, appId) {
  return (items || []).map((change) => ({ ...change, appId }));
}

async function applyAchievementChangeGroupWithRetries(appId, changes) {
  let primary;
  try {
    primary = await applyAchievementChangeGroup(appId, changes);
  } catch {
    primary = { changed: [], failed: changes };
  }

  const changed = withAppId(primary.changed, appId);
  let failed = withAppId(primary.failed, appId);
  if (!failed.length) return { changed, failed };

  try {
    const retry = await applyAchievementChangeGroup(appId, failed, { initMode: 'appid-file' });
    changed.push(...withAppId(retry.changed, appId));
    failed = withAppId(retry.failed, appId);
  } catch {
    // Keep the original failed list.
  }

  if (!failed.length) return { changed, failed };

  try {
    const flatResult = await runSteamFlatHelper(appId, failed.map((change) => ({
      id: change.id,
      achieved: change.achieved,
    })));
    changed.push(...withAppId(flatResult.changed, appId));
    failed = withAppId(flatResult.failed, appId);
  } catch {
    // Keep the failed list from steamworks.js if the native flat helper is unavailable.
  }

  return { changed, failed };
}

function isSuspiciousGameName(name, appId = 0) {
  const value = String(name || '').trim();
  if (!value || value === `App ${Number(appId)}`) return true;
  if (/^\d+=Rj$/i.test(value)) return true;
  const platformParts = value.toLowerCase().split(/[\s,;/|+]+/u).filter(Boolean);
  const platformWords = new Set(['windows', 'macos', 'mac', 'linux', 'steamdeck', 'win32', 'win64', 'macos64']);
  if (platformParts.length && platformParts.every((part) => platformWords.has(part))) return true;
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
    .filter((game) => isSuspiciousGameName(game.name, game.appId))
    .map((game) => Number(game.appId))
    .filter((appId) => Number.isInteger(appId) && appId > 0);
  const details = await getAppDetails(appIds, fetchJson);
  const enriched = [];

  for (const game of games) {
    const appId = Number(game.appId);
    const detail = details.get(appId);
    const type = String(detail?.type || '').toLowerCase();
    if (NON_GAME_STORE_TYPES.has(type)) continue;

    const storeName = String(detail?.name || '').trim();
    const storeIcon = getStoreIconFromDetails(appId, detail);
    const suspiciousLocalName = isSuspiciousGameName(game.name, appId);
    const displayName = storeName && (suspiciousLocalName || game.source === 'localconfig')
      ? storeName
      : (suspiciousLocalName ? '' : String(game.name || '').trim());
    if (!displayName && game.source === 'localconfig' && !game.hasAchievements) continue;
    enriched.push({
      ...game,
      appId,
      name: displayName || storeName || `App ${appId}`,
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
    dataSource: result?.source || { schema: '', achievementStates: [] },
    warnings: result?.warnings || [],
    errors: result?.errors || [],
    achievements: achievements.length,
    verifiedAchievements: achievements.filter((achievement) => achievement.stateKnown !== false).length,
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

async function getValidatedDlcDetails(baseAppId, appIds) {
  const rawDetails = await getAppDetails(appIds, fetchJson);
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
  const [steamRunning, libraries, allSettings] = await Promise.all([
    isSteamRunning(),
    findSteamLibraries(),
    readSettings(),
  ]);
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
  const enrichedLocalGames = await withTimeout(enrichGameListWithStoreDetails(localGames), 20000, localGames);
  if (!apiKey) return enrichedLocalGames;

  const profile = await getCurrentSteamProfile();
  const steamId64 = getSteamId64(profile);
  if (!steamId64) return enrichedLocalGames;

  try {
    const ownedGames = await readOwnedGamesFromWebApi(apiKey, steamId64);
    return await withTimeout(enrichGameListWithStoreDetails(mergeGameLists(enrichedLocalGames, ownedGames)), 20000, mergeGameLists(enrichedLocalGames, ownedGames));
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
  protectedAchievementsByAppId.delete(numericAppId);
  statsByAppId.delete(numericAppId);
  const schema = await getGameSchema(numericAppId, apiKey, language, libraries);
  protectedAchievementsByAppId.set(numericAppId, new Set(
    (schema.achievements || []).filter((achievement) => achievement.changeProtected).map((achievement) => achievement.name)
  ));
  statsByAppId.set(numericAppId, new Map((schema.stats || []).map((stat) => [stat.name, stat])));
  const baseAchievementIds = (schema.achievements || []).map((achievement) => achievement.name);
  const steamId = String(steamId64 || '').trim();
  const baseStates = await readPlayerAchievementStates(numericAppId, baseAchievementIds, apiKey, steamId);
  const baseAchievements = baseAchievementIds.map((id) => {
    const state = normalizeAchievementState(baseStates.states.get(id));
    return {
      id,
      achieved: state.achieved,
      unlockTime: state.unlockTime,
      stateKnown: state.known,
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
      metadataIncomplete: Boolean(meta.metadataIncomplete),
      changeProtected: Boolean(meta.changeProtected),
      icon: meta.icon || '',
      iconGray: meta.iconGray || '',
    };
  });

  const dlcDiscoveryWarnings = [];
  const discoveredDlc = await withTimeout(discoverDlcAppIds(numericAppId, fetchJson, fetchText), 7000, null);
  if (discoveredDlc === null) dlcDiscoveryWarnings.push('DLC discovery timed out.');
  else dlcDiscoveryWarnings.push(...discoveredDlc.warnings);
  const dlcCandidates = discoveredDlc?.ids || [];
  const validatedDlc = dlcCandidates.length
    ? await withTimeout(getValidatedDlcDetails(numericAppId, dlcCandidates), 7000, null)
    : new Map();
  if (validatedDlc === null) dlcDiscoveryWarnings.push('DLC details timed out.');
  const dlcDetails = validatedDlc || new Map();
  const dlcAppIds = [...dlcDetails.keys()];
  const baseAchievementIdSet = new Set(baseAchievementIds);

  const dlcResults = await Promise.all(dlcAppIds.map(async (dlcAppId) => {
    try {
      protectedAchievementsByAppId.delete(dlcAppId);
      const dlcSchema = await getGameSchema(dlcAppId, apiKey, language, libraries);
      protectedAchievementsByAppId.set(dlcAppId, new Set(
        (dlcSchema.achievements || []).filter((achievement) => achievement.changeProtected).map((achievement) => achievement.name)
      ));
      const dlcIds = (dlcSchema.achievements || []).map((achievement) => achievement.name);
      if (!dlcIds.length) {
        const provenance = getGameProvenance(dlcSchema, null, []);
        return { appId: dlcAppId, achievements: [], provenance: provenance.errors.length ? provenance : null };
      }
      if (dlcIds.every((id) => baseAchievementIdSet.has(id))) {
        return { appId: dlcAppId, achievements: [], provenance: null };
      }

      const dlcStates = await readPlayerAchievementStates(dlcAppId, dlcIds, apiKey, steamId, {
        allowSteamworksFallback: false,
      });
      const dlcSchemaById = new Map((dlcSchema.achievements || []).map((item) => [item.name, item]));
      const sourceAppName = dlcDetails.get(dlcAppId)?.name || `DLC ${dlcAppId}`;

      const achievements = dlcIds.map((id) => {
        const state = normalizeAchievementState(dlcStates.states.get(id));
        const meta = dlcSchemaById.get(id) || {};
        return {
          id,
          achieved: state.achieved,
          unlockTime: state.unlockTime,
          stateKnown: state.known,
          appId: dlcAppId,
          sourceAppId: dlcAppId,
          sourceAppName,
          isDlc: true,
          displayName: meta.displayName || id,
          description: meta.description || '',
          hidden: Boolean(meta.hidden),
          metadataIncomplete: Boolean(meta.metadataIncomplete),
          changeProtected: Boolean(meta.changeProtected),
          icon: meta.icon || '',
          iconGray: meta.iconGray || '',
        };
      });
      return {
        appId: dlcAppId,
        achievements,
        provenance: getGameProvenance(dlcSchema, dlcStates, dlcIds),
      };
    } catch (error) {
      return {
        appId: dlcAppId,
        achievements: [],
        provenance: {
          source: { schema: 'unavailable', achievementStates: [] },
          warnings: [],
          errors: [error.message || String(error)],
        },
      };
    }
  }));
  const dlcAchievements = dlcResults.flatMap((entry) => entry.achievements);

  const result = {
    ...getGameProvenance(schema, baseStates, baseAchievementIds, dlcResults),
    schemaStatus: schema.status,
    stateStatus: baseStates.status,
    achievements: [...mergedAchievements, ...dlcAchievements],
    stats: schema.stats || [],
    dlcCount: dlcCandidates.length,
    dlcAchievementCount: dlcAchievements.length,
  };
  result.warnings.push(...dlcDiscoveryWarnings);
  result.diagnostics = makeGameDiagnostics({ appId: numericAppId }, result);
  return result;
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
  const failed = [];
  for (const change of normalizedChanges) {
    if (!Number.isInteger(change.appId) || change.appId <= 0) continue;
    if (protectedAchievementsByAppId.get(change.appId)?.has(change.id)) {
      failed.push({ ...change, reason: 'Steam schema marks this achievement as read-only.' });
      continue;
    }
    if (!groups.has(change.appId)) groups.set(change.appId, []);
    groups.get(change.appId).push({ id: change.id, achieved: change.achieved });
  }

  const changed = [];
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
  }

  return { changed, failed, stored: changed.length > 0 };
});

async function readStatsWithFallback(appId, stats) {
  const requested = stats
    .filter((stat) => stat?.name)
    .map((stat) => ({ ...stat, type: normalizeStatType(stat.type) }));

  try {
    const native = await runSteamFlatHelper(appId, requested, 'stats-read');
    const nativeByName = new Map((native.stats || []).map((stat) => [stat.name, stat]));
    const unreadableInts = requested.filter((stat) => {
      const result = nativeByName.get(stat.name);
      return stat.type === 'int' && result?.readable !== true;
    });
    const fallback = unreadableInts.length
      ? await runSteamWorker({ action: 'readStats', appId, stats: unreadableInts }).catch(() => [])
      : [];
    const fallbackByName = new Map(fallback.map((stat) => [stat.name, stat]));

    return requested.map((stat) => {
      const nativeStat = nativeByName.get(stat.name);
      const fallbackStat = fallbackByName.get(stat.name);
      const result = fallbackStat?.readable ? fallbackStat : nativeStat;
      return {
        ...stat,
        ...(result || {}),
        type: stat.type,
        changeProtected: Boolean(stat.changeProtected),
        writable: Boolean(result?.writable) && !stat.changeProtected,
        source: result?.source || 'native-helper',
        errorCode: result?.errorCode || (result?.readable ? '' : 'not-returned'),
      };
    });
  } catch (nativeError) {
    const fallback = await runSteamWorker({ action: 'readStats', appId, stats: requested });
    return fallback.map((stat) => ({
      ...stat,
      nativeError: nativeError.message,
    }));
  }
}

ipcMain.handle('stats:read', async (_event, { appId }) => {
  const numericAppId = Number(appId);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0) throw new Error('Invalid AppID.');
  const schemaStats = [...(statsByAppId.get(numericAppId)?.values() || [])];
  return readStatsWithFallback(numericAppId, schemaStats);
});

ipcMain.handle('stats:set', async (_event, { appId, name, value, count, sessionLength }) => {
  const numericAppId = Number(appId);
  const statName = String(name || '');
  const stat = statsByAppId.get(numericAppId)?.get(statName);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0 || !stat) {
    throw new Error('Invalid stat change.');
  }
  if (stat?.changeProtected) {
    throw new Error('Steam schema marks this stat as read-only.');
  }
  const statType = normalizeStatType(stat.type);
  if (!['int', 'float', 'avgrate'].includes(statType)) {
    throw new Error('Unsupported stat type.');
  }
  const numericValue = Number(value);
  const numericCount = Number(count);
  const numericSessionLength = Number(sessionLength);
  const invalidAverageRate = statType === 'avgrate' &&
    (!Number.isFinite(numericCount) || numericCount < 0 || !Number.isFinite(numericSessionLength) || numericSessionLength <= 0);
  const invalidInt = statType === 'int' &&
    (!Number.isInteger(numericValue) || numericValue < -2147483648 || numericValue > 2147483647);
  const invalidFloat = statType === 'float' &&
    (!Number.isFinite(numericValue) || Math.abs(numericValue) > 3.4028235e38);
  const belowMin = statType !== 'avgrate' && stat.minValue !== null && stat.minValue !== undefined &&
    numericValue < Number(stat.minValue);
  const aboveMax = statType !== 'avgrate' && stat.maxValue !== null && stat.maxValue !== undefined &&
    numericValue > Number(stat.maxValue);
  if (!statName || invalidAverageRate || invalidInt || invalidFloat || belowMin || aboveMax) {
    throw new Error('Invalid stat change.');
  }

  const change = {
    name: statName,
    type: statType,
    value: numericValue,
    count: numericCount,
    sessionLength: numericSessionLength,
  };

  try {
    const result = await runSteamFlatHelper(numericAppId, [change], 'stats-set');
    if (!(result.changed || []).some((item) => item.name === statName) || !result.stored) {
      throw new Error(result.failed?.[0]?.reason || 'Steam rejected the stat change.');
    }
    return result.changed[0];
  } catch (nativeError) {
    if (statType !== 'int') throw nativeError;
    return runSteamWorker({
      action: 'setStat',
      appId: numericAppId,
      name: statName,
      statType,
      value: change.value,
    });
  }
});

ipcMain.handle('stats:reset', async (_event, { appId }) => {
  const numericAppId = Number(appId);
  if (!Number.isInteger(numericAppId) || numericAppId <= 0) throw new Error('Invalid AppID.');
  const stats = [...(statsByAppId.get(numericAppId)?.values() || [])];
  if (!stats.length) throw new Error('No Steam stats schema is loaded for this app.');
  if (stats.some((stat) => stat.changeProtected)) {
    throw new Error('Steam schema contains read-only stats, so reset is disabled.');
  }
  const typedStats = stats.map((stat) => ({ ...stat, type: normalizeStatType(stat.type) }));
  try {
    const result = await runSteamFlatHelper(numericAppId, typedStats, 'stats-reset');
    if (!result.reset || !result.stored) throw new Error('Steam rejected the stat reset.');
    return result;
  } catch {
    return runSteamWorker({
      action: 'resetStats',
      appId: numericAppId,
    });
  }
});

ipcMain.handle('steamworks:diagnose', async (_event, { appId }) => {
  const numericAppId = Number(appId);
  const [steamworks, native] = await Promise.allSettled([
    runSteamWorker({
      action: 'diagnose',
      appId: numericAppId,
      timeoutMs: 7000,
    }),
    runSteamFlatHelper(numericAppId, [], 'diagnose', { timeoutMs: 10000 }),
  ]);

  return {
    ...(steamworks.status === 'fulfilled' ? steamworks.value : { error: steamworks.reason?.message || String(steamworks.reason) }),
    nativeHelper: native.status === 'fulfilled'
      ? native.value
      : { error: native.reason?.message || String(native.reason) },
  };
});
