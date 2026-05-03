const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

function execReg(args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile('reg', args, { windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }
        resolve(stdout);
      });
    } catch {
      resolve('');
      return;
    }

    child.on('error', () => {
      resolve('');
    });
  });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function hasLocalAchievementSchema(steamRoot, appId) {
  const schemaPath = path.join(steamRoot, 'appcache', 'stats', `UserGameStatsSchema_${appId}.bin`);
  try {
    const buffer = await fs.readFile(schemaPath);
    return buffer.includes(Buffer.from('icon_gray')) || buffer.includes(Buffer.from('icon'));
  } catch {
    return false;
  }
}

function libraryKey(target) {
  return path.normalize(target).replace(/[\\\/]+$/g, '').toLowerCase();
}

function getSteamRootFromLibraries(libraries) {
  return libraries.find((library) => (
    path.basename(path.normalize(library)).toLowerCase() === 'steam'
  )) || libraries[0] || '';
}

async function findSteamRoot() {
  const queries = [
    ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
    ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', '/v', 'InstallPath'],
  ];

  for (const args of queries) {
    const output = await execReg(args);
    const match = output.match(/\s+(SteamPath|InstallPath)\s+REG_SZ\s+(.+)\s*$/im);
    if (match) {
      const candidate = match[2].trim().replace(/\//g, '\\');
      if (await pathExists(candidate)) return candidate;
    }
  }

  const fallback = 'C:\\Program Files (x86)\\Steam';
  return (await pathExists(fallback)) ? fallback : '';
}

function getVdfChild(node, key) {
  if (!node || typeof node !== 'object') return null;
  const match = Object.keys(node).find((name) => name.toLowerCase() === key.toLowerCase());
  return match ? node[match] : null;
}

function collectLocalConfigAppIds(parsed, appIds = new Set()) {
  const store = getVdfChild(parsed, 'UserLocalConfigStore');
  const software = getVdfChild(store, 'Software');
  const valve = getVdfChild(software, 'Valve');
  const steam = getVdfChild(valve, 'Steam');
  const apps = getVdfChild(steam, 'apps');
  if (!apps || typeof apps !== 'object') return appIds;

  for (const [key, value] of Object.entries(apps)) {
    const appId = Number(key);
    if (!Number.isInteger(appId) || appId <= 0) continue;
    if (!value || typeof value !== 'object') continue;
    appIds.add(appId);
  }

  return appIds;
}

async function readLocalConfigAppIds(steamRoot) {
  const userdata = path.join(steamRoot, 'userdata');
  const appIds = new Set();
  let users = [];

  try {
    users = await fs.readdir(userdata, { withFileTypes: true });
  } catch {
    return appIds;
  }

  for (const user of users) {
    if (!user.isDirectory()) continue;
    const configPath = path.join(userdata, user.name, 'config', 'localconfig.vdf');
    try {
      const parsed = parseVdf(await fs.readFile(configPath, 'utf8'));
      collectLocalConfigAppIds(parsed, appIds);
    } catch {
      // Local Steam config can be temporarily locked while Steam writes it.
    }
  }

  return appIds;
}

function extractPrintableStrings(buffer) {
  return [...buffer.toString('utf8').matchAll(/[\p{L}\p{N}\p{P}\p{S} ][\p{L}\p{N}\p{P}\p{S} ]{1,}/gu)]
    .map((match) => match[0].trim())
    .filter(Boolean);
}

function isPlausibleAppName(value) {
  if (!value || value.length < 2 || value.length > 120) return false;
  if (value.includes('\uFFFD')) return false;
  if (!/[\p{L}\p{N}]/u.test(value)) return false;
  if (!/^[\p{L}\p{N}]/u.test(value)) return false;
  if (value.length < 4) return false;
  if ((value.match(/[\p{L}]/gu) || []).length < 2) return false;
  if (/^[a-f0-9]{32,}(?:_thumb)?$/i.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^[\w-]+\/[\w/-]+$/i.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  if (/eula/i.test(value)) return false;
  if (value.startsWith('#')) return false;
  if (/^(game|demo|dlc|tool|music|video|released|windows|macos|linux|win32|win64|macos64)$/i.test(value)) return false;
  return true;
}

function getSteamStoreIcon(appId) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_184x69.jpg`;
}

async function getLocalGameIcon(steamRoot, appId) {
  const cacheDir = path.join(steamRoot, 'appcache', 'librarycache', String(appId));
  let entries = [];
  try {
    entries = await fs.readdir(cacheDir, { withFileTypes: true });
  } catch {
    return '';
  }

  const files = entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name);
  const preferred = files.find((name) => /^[a-f0-9]{40}\.(?:png|jpe?g|webp)$/i.test(name)) ||
    files.find((name) => /^icon\.(?:png|jpe?g|webp)$/i.test(name)) ||
    files.find((name) => !/^(header|library_|logo)/i.test(name)) ||
    files.find((name) => /^header\.(?:png|jpe?g|webp)$/i.test(name));

  return preferred ? pathToFileURL(path.join(cacheDir, preferred)).toString() : '';
}

function isAppInfoRecordStart(buffer, offset) {
  if (offset + 12 >= buffer.length) return false;
  const sectionSize = buffer.readUInt32LE(offset + 4);
  const sectionState = buffer.readUInt32LE(offset + 8);
  return sectionSize > 32 && sectionSize < 16 * 1024 * 1024 && sectionState === 2;
}

function findAppNameInAppInfo(buffer, appId) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(appId);

  let offset = -1;
  while ((offset = buffer.indexOf(needle, offset + 1)) !== -1) {
    if (!isAppInfoRecordStart(buffer, offset)) continue;

    const sectionSize = buffer.readUInt32LE(offset + 4);
    const strings = extractPrintableStrings(buffer.subarray(offset, Math.min(buffer.length, offset + sectionSize)));
    const gameIndex = strings.findIndex((value) => value.toLowerCase() === 'game');
    const candidate = gameIndex > 0 ? strings[gameIndex - 1] : '';
    if (isPlausibleAppName(candidate)) return candidate;

    const fallback = strings.find(isPlausibleAppName);
    if (fallback) return fallback;
  }

  return '';
}

async function readAppInfoNames(steamRoot, appIds) {
  const appInfoPath = path.join(steamRoot, 'appcache', 'appinfo.vdf');
  const names = new Map();
  let buffer;

  try {
    buffer = await fs.readFile(appInfoPath);
  } catch {
    return names;
  }

  for (const appId of appIds) {
    const name = findAppNameInAppInfo(buffer, appId);
    if (name) names.set(appId, name);
  }

  return names;
}

function tokenizeVdf(source) {
  const tokens = [];
  const re = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let match;
  while ((match = re.exec(source))) {
    tokens.push(match[2] || match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return tokens;
}

function parseObject(tokens, cursor) {
  const object = {};
  while (cursor.index < tokens.length) {
    const key = tokens[cursor.index++];
    if (key === '}') break;
    const next = tokens[cursor.index++];
    if (next === '{') {
      object[key] = parseObject(tokens, cursor);
    } else {
      object[key] = next;
    }
  }
  return object;
}

function parseVdf(source) {
  const tokens = tokenizeVdf(source);
  const cursor = { index: 0 };
  const root = {};

  while (cursor.index < tokens.length) {
    const key = tokens[cursor.index++];
    const next = tokens[cursor.index++];
    if (next === '{') {
      root[key] = parseObject(tokens, cursor);
    } else {
      root[key] = next;
    }
  }

  return root;
}

async function findSteamLibraries() {
  const root = await findSteamRoot();
  if (!root) return [];

  const libraries = new Map([[libraryKey(root), path.normalize(root)]]);
  const libraryFile = path.join(root, 'steamapps', 'libraryfolders.vdf');

  try {
    const parsed = parseVdf(await fs.readFile(libraryFile, 'utf8')).libraryfolders || {};
    for (const value of Object.values(parsed)) {
      let candidate = '';
      if (typeof value === 'string') {
        candidate = value;
      } else if (value && typeof value.path === 'string') {
        candidate = value.path;
      }

      if (candidate) {
        libraries.set(libraryKey(candidate), path.normalize(candidate));
      }
    }
  } catch {
    // Steam still keeps the primary library under the root, so an unreadable
    // libraryfolders.vdf is not fatal.
  }

  const existing = [];
  const seenExisting = new Set();
  for (const library of libraries.values()) {
    const key = libraryKey(library);
    if (!seenExisting.has(key) && await pathExists(path.join(library, 'steamapps'))) {
      seenExisting.add(key);
      existing.push(library);
    }
  }
  return existing;
}

async function readInstalledGames(libraries, options = {}) {
  const gamesByAppId = new Map();
  const includeLocalConfig = Boolean(options.includeLocalConfig);

  for (const library of libraries) {
    const steamapps = path.join(library, 'steamapps');
    let entries = [];
    try {
      entries = await fs.readdir(steamapps, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !/^appmanifest_\d+\.acf$/i.test(entry.name)) continue;
      try {
        const manifestPath = path.join(steamapps, entry.name);
        const parsed = parseVdf(await fs.readFile(manifestPath, 'utf8')).AppState || {};
        const appId = Number(parsed.appid);
        if (!Number.isInteger(appId)) continue;
        if (gamesByAppId.has(appId)) continue;
        gamesByAppId.set(appId, {
          appId,
          name: parsed.name || `App ${appId}`,
          icon: '',
          installDir: parsed.installdir || '',
          library,
          manifestPath,
        });
      } catch {
        // Ignore malformed manifests; Steam can leave partial files during updates.
      }
    }
  }

  const steamRoot = getSteamRootFromLibraries(libraries);
  if (steamRoot && includeLocalConfig) {
    const localConfigAppIds = await readLocalConfigAppIds(steamRoot);
    const missingAppIds = [...localConfigAppIds].filter((appId) => !gamesByAppId.has(appId));
    const appInfoNames = await readAppInfoNames(steamRoot, missingAppIds);

    for (const appId of missingAppIds) {
      const name = appInfoNames.get(appId);
      if (!name) continue;
      gamesByAppId.set(appId, {
        appId,
        name,
        icon: '',
        installDir: '',
        library: steamRoot,
        manifestPath: '',
        source: 'localconfig',
      });
    }

  }

  if (steamRoot) {
    for (const game of gamesByAppId.values()) {
      game.icon = await getLocalGameIcon(steamRoot, game.appId) || getSteamStoreIcon(game.appId);
      game.hasAchievements = await hasLocalAchievementSchema(steamRoot, game.appId);
    }
  }

  const games = [...gamesByAppId.values()];
  return games.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  findSteamLibraries,
  readInstalledGames,
  parseVdf,
};
