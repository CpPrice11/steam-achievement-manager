const fs = require('fs/promises');
const path = require('path');

const LANGUAGE_KEYS = new Set([
  'arabic',
  'brazilian',
  'bulgarian',
  'czech',
  'danish',
  'dutch',
  'english',
  'finnish',
  'french',
  'german',
  'greek',
  'hungarian',
  'indonesian',
  'italian',
  'japanese',
  'koreana',
  'latam',
  'norwegian',
  'polish',
  'portuguese',
  'romanian',
  'russian',
  'schinese',
  'spanish',
  'swedish',
  'tchinese',
  'thai',
  'turkish',
  'ukrainian',
  'vietnamese',
]);

const STRUCTURAL_KEYS = new Set([
  'stats',
  'bits',
  'type',
  'type_int',
  'type_float',
  'display',
  'name',
  'desc',
  'token',
  'hidden',
  'icon',
  'icon_gray',
  'permission',
  'default',
  'min',
  'max',
  'incrementonly',
]);

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function requestJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MY SAM local desktop app',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function requestText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MY SAM local desktop app',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function inferStatType(stat) {
  if (typeof stat.type === 'string') return stat.type.toLowerCase();
  const defaultValue = Number(stat.defaultvalue ?? stat.default ?? 0);
  return Number.isInteger(defaultValue) ? 'int' : 'float';
}

function normalizeSchema(data) {
  const game = data?.game || {};
  const available = game.availableGameStats || {};
  const achievements = Array.isArray(available.achievements) ? available.achievements : [];
  const stats = Array.isArray(available.stats) ? available.stats : [];

  return {
    achievements: achievements.map((achievement) => ({
      name: achievement.name || achievement.apiname || '',
      displayName: achievement.displayName || achievement.name || achievement.apiname || '',
      description: achievement.description || '',
      hidden: Number(achievement.hidden || 0) === 1,
      changeProtected: Boolean(achievement.permission),
      icon: achievement.icon || '',
      iconGray: achievement.icongray || achievement.iconGray || '',
    })).filter((achievement) => achievement.name),
    stats: stats.map((stat) => ({
      name: stat.name || '',
      displayName: stat.displayName || stat.name || '',
      defaultValue: Number(stat.defaultvalue ?? stat.default ?? 0),
      type: inferStatType(stat),
      minValue: stat.min !== undefined ? Number(stat.min) : null,
      maxValue: stat.max !== undefined ? Number(stat.max) : null,
      incrementOnly: Boolean(stat.incrementonly || stat.incrementOnly),
    })).filter((stat) => stat.name),
  };
}

function extractStrings(buffer) {
  const source = buffer.toString('utf8');
  return [...source.matchAll(/[\p{L}\p{N}\p{P}\p{S} ][\p{L}\p{N}\p{P}\p{S} ]{1,}/gu)]
    .map((match) => match[0].trim())
    .filter(Boolean);
}

function isApiName(value) {
  if (!value || value.length > 160) return false;
  const lowered = value.toLowerCase();
  if (LANGUAGE_KEYS.has(lowered) || STRUCTURAL_KEYS.has(lowered)) return false;
  return /^[\w:.-]+$/u.test(value);
}

function readLocalized(tokens, start, language) {
  const wanted = (language || 'english').toLowerCase();
  const values = new Map();

  for (let index = start; index < tokens.length; index++) {
    const key = String(tokens[index] || '').toLowerCase();
    if (key === 'token' || key === 'desc' || key === 'hidden' || key === 'icon' || key === 'icon_gray') break;
    if (!LANGUAGE_KEYS.has(key)) break;
    const value = tokens[index + 1] || '';
    if (value && !LANGUAGE_KEYS.has(value.toLowerCase()) && !STRUCTURAL_KEYS.has(value.toLowerCase())) {
      values.set(key, value);
      index += 1;
    }
  }

  return values.get(wanted) || values.get('english') || [...values.values()].find(Boolean) || '';
}

function parseLocalSchemaBuffer(appId, buffer, language) {
  const tokens = extractStrings(buffer);
  const achievements = [];
  const stats = [];
  const seen = new Set();

  for (let index = 0; index < tokens.length - 3; index++) {
    if (tokens[index] !== 'name' || !isApiName(tokens[index + 1])) continue;

    const apiName = tokens[index + 1];
    if (seen.has(apiName)) continue;

    let end = Math.min(tokens.length, index + 120);
    for (let next = index + 2; next < tokens.length - 1; next++) {
      if (next > index + 2 && tokens[next] === 'name' && isApiName(tokens[next + 1])) {
        end = Math.min(end, next);
        break;
      }
    }
    const block = tokens.slice(index + 2, end);

    const displayIndex = block.findIndex((token, offset) => token === 'display' && block[offset + 1] === 'name');
    if (displayIndex === -1) continue;

    const descIndex = block.indexOf('desc');
    const iconIndex = block.indexOf('icon');
    const iconGrayIndex = block.indexOf('icon_gray');
    const changeProtected = block.includes('permission');

    const displayName = readLocalized(block, displayIndex + 2, language) || apiName;
    const description = descIndex === -1 ? '' : readLocalized(block, descIndex + 1, language);
    const iconFile = iconIndex === -1 ? '' : block[iconIndex + 1] || '';
    const iconGrayFile = iconGrayIndex === -1 ? '' : block[iconGrayIndex + 1] || '';

    seen.add(apiName);
    if (iconFile || iconGrayFile) {
      const base = `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/${appId}/`;
      achievements.push({
        name: apiName,
        displayName,
        description,
        hidden: false,
        changeProtected,
        icon: iconFile ? base + iconFile : '',
        iconGray: iconGrayFile ? base + iconGrayFile : '',
      });
    } else {
      stats.push({
        name: apiName,
        displayName,
        defaultValue: 0,
        type: block.includes('type_float') ? 'float' : 'int',
      });
    }
  }

  return { achievements, stats };
}

function getIconHash(url) {
  const match = String(url || '').match(/\/([a-f0-9]{40}\.jpg)(?:$|\?)/i);
  return match ? match[1].toLowerCase() : '';
}

function parseCommunityAchievements(html) {
  const achievements = [];
  const rowPattern = /<div class="achieveRow[\s\S]*?(?=<div class="achieveRow|<div id="footer|<\/body>)/g;
  const rows = String(html || '').match(rowPattern) || [];

  for (const row of rows) {
    const image = row.match(/<img[^>]+src="([^"]+)"/i)?.[1] || '';
    const displayName = decodeHtml(row.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const description = decodeHtml(row.match(/<h5>([\s\S]*?)<\/h5>/i)?.[1] || '');
    const iconHash = getIconHash(image);

    if (iconHash && displayName) {
      achievements.push({ iconHash, displayName, description });
    }
  }

  return achievements;
}

function buildIconUrl(appId, iconHash) {
  const hash = String(iconHash || '').match(/[a-f0-9]{40}\.jpg/i)?.[0] || '';
  return hash ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appId}/${hash}` : '';
}

async function getCommunityAchievementText(appId, language) {
  const requestedLanguage = String(language || 'english').toLowerCase();
  const url = `https://steamcommunity.com/stats/${appId}/achievements/?l=${encodeURIComponent(requestedLanguage)}`;
  const achievements = parseCommunityAchievements(await requestText(url));
  if (achievements.length || requestedLanguage === 'english') return achievements;

  return parseCommunityAchievements(await requestText(`https://steamcommunity.com/stats/${appId}/achievements/?l=english`));
}

async function applyCommunityLocalization(appId, schema, language) {
  const communityAchievements = await getCommunityAchievementText(appId, language);
  if (!communityAchievements.length) return { localized: 0, schema };

  const byIcon = new Map();
  for (const achievement of communityAchievements) {
    byIcon.set(achievement.iconHash, achievement);
  }

  let localized = 0;
  const canUseIndex = communityAchievements.length === schema.achievements.length &&
    schema.achievements.every((achievement) => !getIconHash(achievement.icon) && !getIconHash(achievement.iconGray));

  const achievements = schema.achievements.map((achievement, index) => {
    const iconHash = getIconHash(achievement.icon) || getIconHash(achievement.iconGray);
    const community = (iconHash ? byIcon.get(iconHash) : null) || (canUseIndex ? communityAchievements[index] : null);

    if (!community) return achievement;
    localized += 1;
    return {
      ...achievement,
      displayName: community.displayName || achievement.displayName,
      description: community.description || achievement.description,
      icon: achievement.icon || buildIconUrl(appId, community.iconHash),
      iconGray: achievement.iconGray || buildIconUrl(appId, community.iconHash),
    };
  });

  return {
    localized,
    schema: { ...schema, achievements },
  };
}

async function getLocalGameSchema(appId, language, libraries = []) {
  for (const library of libraries) {
    const schemaPath = path.join(library, 'appcache', 'stats', `UserGameStatsSchema_${appId}.bin`);
    try {
      const parsed = parseLocalSchemaBuffer(appId, await fs.readFile(schemaPath), language);
      if (parsed.achievements.length || parsed.stats.length) {
        return { status: 'loaded-local', ...parsed };
      }
    } catch {
      // Not every library is the Steam root and not every game has cached stats.
    }
  }
  return { status: 'missing-local', achievements: [], stats: [] };
}

async function getWebGameSchema(appId, apiKey = '', language = 'english') {
  const params = new URLSearchParams({
    appid: String(appId),
    l: language || 'english',
    format: 'json',
  });

  if (apiKey) params.set('key', apiKey);

  const urls = [
    `https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?${params}`,
    `https://partner.steam-api.com/ISteamUserStats/GetSchemaForGame/v2/?${params}`,
  ];

  const errors = [];
  for (const url of urls) {
    try {
      const schema = normalizeSchema(await requestJson(url));
      return {
        status: schema.achievements.length || schema.stats.length ? 'loaded' : 'empty',
        ...schema,
      };
    } catch (error) {
      errors.push(error.message);
    }
  }

  return {
    status: `unavailable: ${errors.join('; ')}`,
    achievements: [],
    stats: [],
  };
}

async function getGlobalAchievementSchema(appId) {
  const url = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}&format=json`;

  try {
    const body = await requestJson(url);
    const achievements = Array.isArray(body?.achievementpercentages?.achievements)
      ? body.achievementpercentages.achievements
      : [];

    return {
      status: achievements.length ? 'loaded-global' : 'empty-global',
      achievements: achievements
        .map((achievement) => ({
          name: achievement.name || '',
          displayName: achievement.name || '',
          description: '',
          hidden: false,
          icon: '',
          iconGray: '',
        }))
        .filter((achievement) => achievement.name),
      stats: [],
    };
  } catch (error) {
    return {
      status: `unavailable-global: ${error.message}`,
      achievements: [],
      stats: [],
    };
  }
}

function mergeSchemas(primary, fallback) {
  const achievementsByName = new Map();
  const statsByName = new Map();

  for (const schema of [fallback, primary]) {
    for (const achievement of schema?.achievements || []) {
      const name = achievement.name || '';
      if (!name) continue;
      achievementsByName.set(name, {
        ...(achievementsByName.get(name) || {}),
        ...achievement,
        displayName: achievement.displayName || achievementsByName.get(name)?.displayName || name,
        description: achievement.description || achievementsByName.get(name)?.description || '',
        changeProtected: Boolean(achievement.changeProtected || achievementsByName.get(name)?.changeProtected),
        icon: achievement.icon || achievementsByName.get(name)?.icon || '',
        iconGray: achievement.iconGray || achievementsByName.get(name)?.iconGray || '',
      });
    }

    for (const stat of schema?.stats || []) {
      const name = stat.name || '';
      if (!name) continue;
      statsByName.set(name, {
        ...(statsByName.get(name) || {}),
        ...stat,
        displayName: stat.displayName || statsByName.get(name)?.displayName || name,
      });
    }
  }

  return {
    achievements: [...achievementsByName.values()],
    stats: [...statsByName.values()],
  };
}

async function getGameSchema(appId, apiKey = '', language = 'english', libraries = []) {
  const local = await getLocalGameSchema(appId, language, libraries);
  const web = await getWebGameSchema(appId, apiKey, language);
  const global = await getGlobalAchievementSchema(appId);
  const hasLocal = local.achievements.length || local.stats.length;
  const hasWeb = web.achievements.length || web.stats.length;
  const hasGlobal = global.achievements.length;

  if (hasLocal || hasWeb || hasGlobal) {
    const bestStructured = hasWeb && web.achievements.length >= local.achievements.length ? web : local;
    const secondaryStructured = bestStructured === web ? local : web;
    const merged = mergeSchemas(bestStructured, mergeSchemas(secondaryStructured, global));

    try {
      const localized = await applyCommunityLocalization(appId, merged, language);
      const status = [
        hasLocal ? local.status : '',
        hasWeb ? web.status : '',
        hasGlobal ? global.status : '',
        localized.localized ? 'community' : '',
      ].filter(Boolean).join('+');
      return {
        ...localized.schema,
        status: status || 'loaded',
      };
    } catch {
      return {
        ...merged,
        status: [hasLocal ? local.status : '', hasWeb ? web.status : '', hasGlobal ? global.status : ''].filter(Boolean).join('+') || 'loaded',
      };
    }
  }

  return web.status && web.status !== 'empty'
    ? web
    : { status: local.status || web.status || 'empty', achievements: [], stats: [] };
}

module.exports = { getGameSchema, getLocalGameSchema, parseLocalSchemaBuffer, parseCommunityAchievements };
