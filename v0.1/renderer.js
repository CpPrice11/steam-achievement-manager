const GAME_CACHE_MAX = 25;
const ALLOWED_LANGUAGES = ['ukrainian', 'english'];
const ALLOWED_THEMES = ['dark', 'light', 'system'];
const ALLOWED_UI_SCALES = ['compact', 'normal', 'large'];
const ALLOWED_GAME_SORTS = ['name', 'appid', 'achievements-first', 'risk-first', 'issues-first'];

function pickAllowed(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const state = {
  games: [],
  selectedGame: null,
  achievements: [],
  achievementByKey: new Map(),
  pendingAchievements: new Map(),
  statsSchema: [],
  stats: [],
  diagnostics: null,
  history: [],
  settings: { apiKey: '', language: 'ukrainian', theme: 'dark' },
  activeProfileId: '',
  activePersona: '',
  gameRiskFilter: 'all',
  gameSort: 'name',
  activeTab: 'achievements',
  achievementFilter: 'all',
  dlcFilter: 'all',
  achievementSort: 'default',
  achievementViewMode: 'table',
  gameCache: new Map(),
  loadToken: 0,
  statsFilter: '',
  statsTypeFilter: 'all',
  steamworksDiagnostics: null,
};

function setAchievementsState(next) {
  state.achievements = next;
  state.achievementByKey = new Map(next.map((achievement) => [getAchievementKey(achievement), achievement]));
}

function getGameCacheEntry(key) {
  if (!state.gameCache.has(key)) return undefined;
  const value = state.gameCache.get(key);
  state.gameCache.delete(key);
  state.gameCache.set(key, value);
  return value;
}

function setGameCacheEntry(key, value) {
  if (state.gameCache.has(key)) state.gameCache.delete(key);
  state.gameCache.set(key, value);
  while (state.gameCache.size > GAME_CACHE_MAX) {
    const oldest = state.gameCache.keys().next().value;
    state.gameCache.delete(oldest);
  }
}

const elements = {
  steamStatus: document.querySelector('#steamStatus'),
  refreshButton: document.querySelector('#refreshButton'),
  gameSearch: document.querySelector('#gameSearch'),
  gamesWithAchievementsOnly: document.querySelector('#gamesWithAchievementsOnly'),
  gameRiskFilter: document.querySelector('#gameRiskFilter'),
  gameSort: document.querySelector('#gameSort'),
  libraryDiagnosticsButton: document.querySelector('#libraryDiagnosticsButton'),
  themeInput: document.querySelector('#themeInput'),
  uiScaleInput: document.querySelector('#uiScaleInput'),
  appearanceSettingsButton: document.querySelector('#appearanceSettingsButton'),
  appearancePanel: document.querySelector('#appearancePanel'),
  gameCount: document.querySelector('#gameCount'),
  gameList: document.querySelector('#gameList'),
  selectedGame: document.querySelector('#selectedGame'),
  selectedAppId: document.querySelector('#selectedAppId'),
  openSteamButton: document.querySelector('#openSteamButton'),
  refreshGameButton: document.querySelector('#refreshGameButton'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  languageInput: document.querySelector('#languageInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  notice: document.querySelector('#notice'),
  loadingIndicator: document.querySelector('#loadingIndicator'),
  loadingText: document.querySelector('#loadingText'),
  loadingDetail: document.querySelector('#loadingDetail'),
  progressSummary: document.querySelector('#progressSummary'),
  progressText: document.querySelector('#progressText'),
  progressPercent: document.querySelector('#progressPercent'),
  progressBar: document.querySelector('#progressBar'),
  achievementSearch: document.querySelector('#achievementSearch'),
  achievementList: document.querySelector('#achievementList'),
  achievementCount: document.querySelector('#achievementCount'),
  unlockAllButton: document.querySelector('#unlockAllButton'),
  lockAllButton: document.querySelector('#lockAllButton'),
  applyAchievementChangesButton: document.querySelector('#applyAchievementChangesButton'),
  cancelPendingChangesButton: document.querySelector('#cancelPendingChangesButton'),
  loadStatsButton: document.querySelector('#loadStatsButton'),
  resetStatsButton: document.querySelector('#resetStatsButton'),
  steamworksDiagnosticsButton: document.querySelector('#steamworksDiagnosticsButton'),
  statsSearch: document.querySelector('#statsSearch'),
  statsTypeFilter: document.querySelector('#statsTypeFilter'),
  gameDiagnostics: document.querySelector('#gameDiagnostics'),
  statsList: document.querySelector('#statsList'),
  statsCount: document.querySelector('#statsCount'),
  refreshHistoryButton: document.querySelector('#refreshHistoryButton'),
  openBackupsFolderButton: document.querySelector('#openBackupsFolderButton'),
  historyList: document.querySelector('#historyList'),
  historyCount: document.querySelector('#historyCount'),
};

const RISKY_APP_IDS = new Set([
  10, 80, 100, 240, 440, 550, 570, 730, 578080, 1172470, 1938090, 1966720, 230410, 236390, 252490, 381210,
]);

const RISKY_NAME_PATTERNS = [
  /\b(counter-strike|cs2|dota|team fortress|apex|pubg|warframe|destiny|rainbow six|rust|dead by daylight)\b/i,
  /\b(online|multiplayer|battle royale|anti-cheat|vac)\b/i,
];

const UI_TRANSLATIONS = {
  ukrainian: {
    appTitle: 'Steam Achievement Manager',
    steamChecking: 'Steam: перевірка...',
    refresh: 'Оновити',
    gameSearchLabel: 'Пошук гри',
    gameSearchPlaceholder: 'Назва або AppID',
    onlyAchievements: 'Тільки ігри з досягненнями',
    risk: 'Ризик',
    gameSort: 'Сортування',
    allGames: 'Усі ігри',
    safeGames: 'Без позначки ризику',
    riskyGames: 'Тільки ризикові',
    libraryDiagnostics: 'Перевірити бібліотеку',
    noGameSelectedMeta: 'Гру не вибрано',
    chooseGame: 'Оберіть гру',
    openSteam: 'Відкрити сторінку гри в Steam',
    refreshGame: 'Оновити поточну гру',
    save: 'Зберегти',
    appearance: 'Налаштування',
    uiLanguage: 'Мова програми й досягнень',
    theme: 'Тема',
    dark: 'Темна',
    light: 'Світла',
    system: 'Як у Windows',
    uiScale: 'Розмір інтерфейсу',
    compactScale: 'Компактний',
    normalScale: 'Звичайний',
    largeScale: 'Більший',
    achievements: 'Досягнення',
    extra: 'Додатково',
    history: 'Історія',
    all: 'Усі',
    everything: 'Усе',
    unlocked: 'Розблоковані',
    locked: 'Заблоковані',
    changed: 'Змінені',
    baseGame: 'Основна гра',
    achievementSort: 'Сортування досягнень',
    defaultSort: 'Як у Steam',
    nameSort: 'Назва A-Z',
    lockedFirst: 'Заблоковані спочатку',
    unlockedFirst: 'Розблоковані спочатку',
    changedFirst: 'Змінені спочатку',
    hiddenFirst: 'Приховані спочатку',
    dlcFirst: 'DLC спочатку',
    newestUnlocks: 'Новіші розблокування',
    oldestUnlocks: 'Старіші розблокування',
    unlockTime: 'Час розблокування',
    noUnlockTime: 'без часу',
    unlockAll: 'Розблокувати всі досягнення',
    lockAll: 'Заблокувати всі досягнення',
    applyChanges: 'Підтвердити зміни',
    cancelChanges: 'Скасувати підготовлені зміни',
    loadStats: 'Завантажити статистику',
    resetStats: 'Скинути статистику',
    checkSteamworks: 'Перевірити Steamworks',
    statsFilter: 'Фільтр статистики',
    allStats: 'Уся статистика',
    editableStats: 'Змінювана',
    readonlyStats: 'Тільки читання',
    statsUnavailable: 'За цим фільтром статистики немає.',
    statsDiagnostics: 'Діагностика статистики',
    readableStats: 'читабельні',
    writableStats: 'змінювані',
    unsupportedStats: 'не підтримуються',
    refreshHistory: 'Оновити історію',
    openBackups: 'Відкрити папку backup',
    diagnosticsTitle: 'Діагностика гри',
    diagnosticsEmpty: 'Оберіть гру, щоб побачити діагностику.',
    noStatsSchema: 'Для цієї гри не знайдено schema статистики.',
    statsEmpty: "Статистика з'явиться, якщо Steam поверне schema для гри.",
    historyEmpty: 'Історія змін поки порожня.',
    noGamesFound: 'Ігор не знайдено.',
    noAchievementsAvailable: 'Список досягнень поки недоступний для цієї гри.',
    chooseGameForAchievements: 'Оберіть гру, щоб завантажити досягнення.',
  },
  english: {
    appTitle: 'Steam Achievement Manager',
    steamChecking: 'Steam: checking...',
    refresh: 'Refresh',
    gameSearchLabel: 'Game search',
    gameSearchPlaceholder: 'Name or AppID',
    onlyAchievements: 'Only games with achievements',
    risk: 'Risk',
    gameSort: 'Sorting',
    allGames: 'All games',
    safeGames: 'Without risk marker',
    riskyGames: 'Risky only',
    libraryDiagnostics: 'Check library',
    noGameSelectedMeta: 'No game selected',
    chooseGame: 'Choose a game from the list',
    openSteam: 'Open game page in Steam',
    refreshGame: 'Refresh current game only',
    save: 'Save',
    appearance: 'Settings',
    uiLanguage: 'App and achievement language',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    system: 'Use Windows',
    uiScale: 'Interface size',
    compactScale: 'Compact',
    normalScale: 'Normal',
    largeScale: 'Larger',
    achievements: 'Achievements',
    extra: 'Extra',
    history: 'History',
    all: 'All',
    everything: 'All',
    unlocked: 'Unlocked',
    locked: 'Locked',
    changed: 'Changed',
    baseGame: 'Base game',
    achievementSort: 'Achievement sorting',
    defaultSort: 'Steam order',
    nameSort: 'Name A-Z',
    lockedFirst: 'Locked first',
    unlockedFirst: 'Unlocked first',
    changedFirst: 'Changed first',
    hiddenFirst: 'Hidden first',
    dlcFirst: 'DLC first',
    newestUnlocks: 'Newest unlocks',
    oldestUnlocks: 'Oldest unlocks',
    unlockTime: 'Unlock time',
    noUnlockTime: 'no time',
    unlockAll: 'Unlock all achievements',
    lockAll: 'Lock all achievements',
    applyChanges: 'Apply changes',
    cancelChanges: 'Cancel prepared changes',
    loadStats: 'Load stats',
    resetStats: 'Reset stats',
    checkSteamworks: 'Check Steamworks',
    statsFilter: 'Stats filter',
    allStats: 'All stats',
    editableStats: 'Editable',
    readonlyStats: 'Read only',
    statsUnavailable: 'No stats match this filter.',
    statsDiagnostics: 'Stats diagnostics',
    readableStats: 'readable',
    writableStats: 'editable',
    unsupportedStats: 'unsupported',
    refreshHistory: 'Refresh history',
    openBackups: 'Open backup folder',
    diagnosticsTitle: 'Game diagnostics',
    diagnosticsEmpty: 'Choose a game to see diagnostics.',
    noStatsSchema: 'No stats schema was found for this game.',
    statsEmpty: 'Stats appear here if Steam returns a schema for the game.',
    historyEmpty: 'Change history is empty.',
    noGamesFound: 'No games found.',
    noAchievementsAvailable: 'The achievement list is not available for this game yet.',
    chooseGameForAchievements: 'Choose a game to load achievements.',
  },
};

function getUiLanguage() {
  const value = String(elements.languageInput?.value || state.settings.language || 'ukrainian').toLowerCase();
  return UI_TRANSLATIONS[value] ? value : 'ukrainian';
}

function t(key, fallback = '') {
  const language = getUiLanguage();
  return UI_TRANSLATIONS[language][key] || UI_TRANSLATIONS.english[key] || fallback || key;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setAttr(selector, attribute, value) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute(attribute, value);
}

function applyUiLanguage() {
  document.documentElement.lang = getUiLanguage() === 'ukrainian' ? 'uk' : 'en';
  document.title = t('appTitle');
  setText('.brand h1', t('appTitle'));
  setAttr('#refreshButton', 'title', t('refresh'));
  setText('.field span', t('gameSearchLabel'));
  elements.gameSearch.placeholder = t('gameSearchPlaceholder');
  setText('.toggle-field span', t('onlyAchievements'));
  setText('.compact-field span', t('risk'));
  elements.gameRiskFilter.options[0].textContent = t('allGames');
  elements.gameRiskFilter.options[1].textContent = t('safeGames');
  elements.gameRiskFilter.options[2].textContent = t('riskyGames');
  setText('#gameSortLabel', t('gameSort'));
  elements.gameSort.options[0].textContent = t('nameSort');
  elements.gameSort.options[1].textContent = 'AppID';
  elements.gameSort.options[2].textContent = getUiLanguage() === 'english' ? 'Achievements first' : 'З досягненнями спочатку';
  elements.gameSort.options[3].textContent = getUiLanguage() === 'english' ? 'Risky first' : 'Ризикові спочатку';
  elements.gameSort.options[4].textContent = getUiLanguage() === 'english' ? 'Issues first' : 'Проблемні спочатку';
  elements.libraryDiagnosticsButton.textContent = t('libraryDiagnostics');
  elements.libraryDiagnosticsButton.title = t('libraryDiagnostics');
  elements.openSteamButton.title = t('openSteam');
  elements.refreshGameButton.title = t('refreshGame');
  elements.refreshGameButton.textContent = `↻ ${getUiLanguage() === 'english' ? 'Game' : 'Гра'}`;
  elements.appearanceSettingsButton.title = t('appearance');
  elements.appearanceSettingsButton.setAttribute('aria-label', t('appearance'));
  setText('#apiKeyLabel', 'Steam Web API key');
  elements.saveSettingsButton.textContent = t('save');
  setText('#uiLanguageLabel', t('uiLanguage'));
  elements.languageInput.title = t('uiLanguage');
  setText('#themeLabel', t('theme'));
  elements.themeInput.options[0].textContent = t('dark');
  elements.themeInput.options[1].textContent = t('light');
  elements.themeInput.options[2].textContent = t('system');
  setText('#uiScaleLabel', t('uiScale'));
  elements.uiScaleInput.options[0].textContent = t('compactScale');
  elements.uiScaleInput.options[1].textContent = t('normalScale');
  elements.uiScaleInput.options[2].textContent = t('largeScale');
  document.querySelector('[data-tab="achievements"]').textContent = t('achievements');
  document.querySelector('[data-tab="stats"]').textContent = t('extra');
  document.querySelector('[data-tab="history"]').textContent = t('history');
  setAttr('.achievement-filters', 'aria-label', t('achievements'));
  setAttr('.source-filters', 'aria-label', 'DLC');
  elements.unlockAllButton.title = t('unlockAll');
  elements.unlockAllButton.setAttribute('aria-label', t('unlockAll'));
  elements.lockAllButton.title = t('lockAll');
  elements.lockAllButton.setAttribute('aria-label', t('lockAll'));
  elements.applyAchievementChangesButton.title = t('applyChanges');
  elements.applyAchievementChangesButton.setAttribute('aria-label', t('applyChanges'));
  elements.cancelPendingChangesButton.title = t('cancelChanges');
  elements.cancelPendingChangesButton.setAttribute('aria-label', t('cancelChanges'));
  elements.loadStatsButton.textContent = t('loadStats');
  elements.resetStatsButton.textContent = t('resetStats');
  elements.steamworksDiagnosticsButton.textContent = t('checkSteamworks');
  elements.statsSearch.placeholder = t('statsFilter');
  elements.statsTypeFilter.options[0].textContent = t('allStats');
  elements.statsTypeFilter.options[1].textContent = t('editableStats');
  elements.statsTypeFilter.options[2].textContent = t('readonlyStats');
  elements.statsTypeFilter.options[3].textContent = t('unsupportedStats');
  elements.refreshHistoryButton.textContent = t('refreshHistory');
  elements.openBackupsFolderButton.textContent = t('openBackups');
  renderSelection();
}

function showNotice(message, tone = 'info') {
  elements.notice.textContent = message;
  elements.notice.className = `notice ${tone}`;
  if (!message) elements.notice.classList.add('hidden');
}

function setLoading(message = '', detail = '') {
  elements.loadingText.textContent = message || 'Завантаження...';
  elements.loadingDetail.textContent = detail;
  elements.loadingIndicator.classList.toggle('hidden', !message);
}

function setLanguageValue(language) {
  const value = String(language || 'ukrainian');
  const hasOption = [...elements.languageInput.options].some((option) => option.value === value);
  elements.languageInput.value = hasOption ? value : 'ukrainian';
  state.settings.language = elements.languageInput.value;
}

function setThemeValue(theme) {
  elements.themeInput.value = pickAllowed(theme, ALLOWED_THEMES, 'dark');
}

function setScaleValue(scale) {
  elements.uiScaleInput.value = pickAllowed(scale, ALLOWED_UI_SCALES, 'compact');
}

function applyAppearance() {
  const theme = elements.themeInput.value || state.settings.theme || 'dark';
  const scale = elements.uiScaleInput.value || state.settings.uiScale || 'compact';
  const systemLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const resolvedTheme = theme === 'system' ? (systemLight ? 'light' : 'dark') : theme;

  document.body.classList.toggle('theme-light', resolvedTheme === 'light');
  document.body.classList.toggle('compact-mode', scale === 'compact');
  document.body.classList.toggle('scale-normal', scale === 'normal');
  document.body.classList.toggle('scale-large', scale === 'large');
}

function getSchemaNotice(schemaStatus, hasAchievements) {
  const status = String(schemaStatus || '');

  if (status.startsWith('loaded') && hasAchievements) {
    return '';
  }

  if (status.startsWith('loaded')) {
    return 'У цієї гри не знайдено досягнень. Можливо, гра не підтримує Steam-досягнення або Steam ще не має їх у локальному кеші.';
  }

  if (status === 'empty' || status === 'missing-local' || status.startsWith('unavailable')) {
    return 'Не вдалося отримати список досягнень для цієї гри. Спробуйте запустити гру один раз через Steam, а потім натисніть оновлення. Якщо список усе ще порожній, можна додати Steam Web API key у полі зверху.';
  }

  return 'Не вдалося завантажити дані цієї гри. Перевірте, чи Steam запущений, і спробуйте оновити список.';
}

function setBusy(target, busy) {
  target.disabled = busy;
  target.classList.toggle('busy', busy);
}

function getAchievementDraftState(achievement) {
  const key = getAchievementKey(achievement);
  return state.pendingAchievements.has(key)
    ? state.pendingAchievements.get(key)
    : achievement.achieved;
}

function setPendingAchievement(achievement, achieved) {
  const key = getAchievementKey(achievement);
  if (achievement.achieved === achieved) {
    state.pendingAchievements.delete(key);
  } else {
    state.pendingAchievements.set(key, achieved);
  }
}

function getAchievementKey(achievement) {
  const appId = Number(achievement?.appId || achievement?.sourceAppId || state.selectedGame?.appId || 0);
  return `${appId}:${achievement?.id || ''}`;
}

function isRiskyGame(game) {
  if (!game) return false;
  return RISKY_APP_IDS.has(Number(game.appId)) || RISKY_NAME_PATTERNS.some((pattern) => pattern.test(game.name));
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

function isDlcAchievement(achievement) {
  return Boolean(achievement.isDlc) ||
    Number(achievement.sourceAppId || achievement.appId) !== Number(state.selectedGame?.appId);
}

function getDlcGroupCount(achievements) {
  const groups = new Set();
  for (const achievement of achievements || []) {
    if (!isDlcAchievement(achievement)) continue;
    const key = String(achievement.sourceAppName || achievement.sourceAppId || achievement.appId || '').trim();
    if (key) groups.add(key);
  }
  return groups.size;
}

function isAchievementChangeProtected(achievement) {
  return Boolean(achievement.changeProtected);
}

function getSteamCdnAlternates(url) {
  const value = String(url || '');
  if (!value) return [];

  const alternates = new Set([value]);
  const match = value.match(/\/steamcommunity\/public\/images\/apps\/(\d+)\/([a-f0-9]{40}\.jpg)(?:$|\?)/i);
  if (match) {
    const path = `/steamcommunity/public/images/apps/${match[1]}/${match[2]}`;
    alternates.add(`https://cdn.cloudflare.steamstatic.com${path}`);
    alternates.add(`https://cdn.akamai.steamstatic.com${path}`);
    alternates.add(`https://media.steampowered.com${path}`);
  }

  return [...alternates];
}

function getAchievementIconUrls(achievement, achieved) {
  const primary = achieved ? achievement.icon : achievement.iconGray;
  const secondary = achieved ? achievement.iconGray : achievement.icon;
  const urls = [];

  for (const url of [primary, secondary]) {
    for (const alternate of getSteamCdnAlternates(url)) {
      if (alternate && !urls.includes(alternate)) urls.push(alternate);
    }
  }

  return urls;
}

function formatUnlockTime(achievement) {
  const timestamp = Number(achievement?.unlockTime || 0);
  if (!timestamp) return t('noUnlockTime');
  try {
    return new Intl.DateTimeFormat(getUiLanguage() === 'english' ? 'en' : 'uk', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp * 1000));
  } catch {
    return new Date(timestamp * 1000).toLocaleString();
  }
}

function bindRetryingImage(image, urls, blankClass) {
  const candidates = urls.filter(Boolean);
  let index = 0;

  function loadCurrent(cacheBust = false) {
    const url = candidates[index] || '';
    image.src = cacheBust && url
      ? `${url}${url.includes('?') ? '&' : '?'}sam_retry=${Date.now()}`
      : url;
  }

  image.classList.toggle(blankClass, !candidates.length);
  if (!candidates.length) return;

  if (window.sam.cacheImage) {
    window.sam.cacheImage(candidates)
      .then((result) => {
        if (result?.fileUrl && image.isConnected) {
          image.dataset.cached = '1';
          image.src = result.fileUrl;
        }
      })
      .catch(() => {});
  }

  image.addEventListener('load', () => {
    image.classList.remove(blankClass);
  });

  image.addEventListener('error', () => {
    index += 1;
    if (index < candidates.length) {
      loadCurrent(false);
      return;
    }

    if (!image.dataset.retried) {
      image.dataset.retried = '1';
      index = 0;
      window.setTimeout(() => loadCurrent(true), 450);
      return;
    }

    const baseClass = [...image.classList].filter((name) => name !== blankClass && name !== 'placeholder').join(' ');
    const fallbackText = '';
    image.replaceWith(createIconPlaceholder(baseClass || image.className, fallbackText));
  });

  loadCurrent(false);
}

function createIconPlaceholder(className, text = '') {
  const placeholder = document.createElement('span');
  placeholder.className = `${className} placeholder`;
  placeholder.textContent = text;
  placeholder.setAttribute('aria-hidden', 'true');
  return placeholder;
}

function updateChipLabel(button, label, count) {
  const isActive = button.classList.contains('active');
  button.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${Number(count || 0)}</strong>
  `;
  button.type = 'button';
  button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  button.title = getUiLanguage() === 'english'
    ? `Show ${label.toLowerCase()} achievements`
    : `Показати: ${label.toLowerCase()}`;
}

function applyAchievementStatusFilter(filter) {
  state.achievementFilter = filter || 'all';
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.achievementFilter === state.achievementFilter);
  });
  renderAchievements();
}

function applyAchievementSourceFilter(filter) {
  state.dlcFilter = filter || 'all';
  document.querySelectorAll('.source-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.dlcFilter === state.dlcFilter);
  });
  renderAchievements();
}

function setAchievementSort(sort) {
  state.achievementSort = sort || 'default';
  renderAchievements();
}

function updateAchievementFilterLabels() {
  const counts = state.achievements.reduce((acc, achievement) => {
    const draftAchieved = getAchievementDraftState(achievement);
    const isChanged = state.pendingAchievements.has(getAchievementKey(achievement));
    const isDlc = isDlcAchievement(achievement);

    acc.all += 1;
    acc[draftAchieved ? 'unlocked' : 'locked'] += 1;
    if (isChanged) acc.changed += 1;
    acc[isDlc ? 'dlc' : 'base'] += 1;
    return acc;
  }, {
    all: 0,
    unlocked: 0,
    locked: 0,
    changed: 0,
    base: 0,
    dlc: 0,
  });

  const statusLabels = {
    all: t('all'),
    unlocked: t('unlocked'),
    locked: t('locked'),
    changed: t('changed'),
  };
  const sourceLabels = {
    all: t('everything'),
    base: t('baseGame'),
    dlc: 'DLC',
  };

  document.querySelectorAll('.filter-chip').forEach((button) => {
    const filter = button.dataset.achievementFilter || 'all';
    updateChipLabel(button, statusLabels[filter] || filter, counts[filter]);
    button.disabled = !state.selectedGame || counts.all === 0 || (filter !== 'all' && counts[filter] === 0);
  });

  document.querySelectorAll('.source-chip').forEach((button) => {
    const filter = button.dataset.dlcFilter || 'all';
    updateChipLabel(button, sourceLabels[filter] || filter, counts[filter]);
    button.disabled = !state.selectedGame || counts.all === 0 || (filter !== 'all' && counts[filter] === 0);
  });

  if (state.dlcFilter === 'dlc' && counts.dlc === 0) {
    state.dlcFilter = 'all';
    document.querySelectorAll('.source-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.dlcFilter === 'all'));
  }
  if (state.dlcFilter === 'base' && counts.base === 0) {
    state.dlcFilter = 'all';
    document.querySelectorAll('.source-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.dlcFilter === 'all'));
  }
  if (state.achievementFilter !== 'all' && counts[state.achievementFilter] === 0) {
    state.achievementFilter = 'all';
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.achievementFilter === 'all'));
  }

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.achievementFilter === state.achievementFilter);
  });
  document.querySelectorAll('.source-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.dlcFilter === state.dlcFilter);
  });
}

function sortAchievements(achievements) {
  const sorted = [...achievements];
  const byOriginalOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  const byName = (a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id));
  const byDlc = (a, b) => {
    const left = isDlcAchievement(a) ? 0 : 1;
    const right = isDlcAchievement(b) ? 0 : 1;
    return left - right || byOriginalOrder(a, b);
  };
  const byBase = (a, b) => {
    const left = isDlcAchievement(a) ? 1 : 0;
    const right = isDlcAchievement(b) ? 1 : 0;
    return left - right || byOriginalOrder(a, b);
  };
  const byUnlockTime = (direction) => (a, b) => {
    const left = Number(a.unlockTime || 0);
    const right = Number(b.unlockTime || 0);
    const leftRank = left ? 0 : 1;
    const rightRank = right ? 0 : 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return direction === 'asc'
      ? left - right || byOriginalOrder(a, b)
      : right - left || byOriginalOrder(a, b);
  };
  const byDraftState = (wanted) => (a, b) => {
    const left = getAchievementDraftState(a) === wanted ? 0 : 1;
    const right = getAchievementDraftState(b) === wanted ? 0 : 1;
    return left - right || byOriginalOrder(a, b);
  };

  if (state.achievementSort === 'name') sorted.sort(byName);
  if (state.achievementSort === 'dlc-first') sorted.sort(byDlc);
  if (state.achievementSort === 'base-first') sorted.sort(byBase);
  if (state.achievementSort === 'unlock-time-desc') sorted.sort(byUnlockTime('desc'));
  if (state.achievementSort === 'unlock-time-asc') sorted.sort(byUnlockTime('asc'));
  if (state.achievementSort === 'locked-first') sorted.sort(byDraftState(false));
  if (state.achievementSort === 'unlocked-first') sorted.sort(byDraftState(true));
  if (state.achievementSort === 'changed-first') {
    sorted.sort((a, b) => {
      const left = state.pendingAchievements.has(getAchievementKey(a)) ? 0 : 1;
      const right = state.pendingAchievements.has(getAchievementKey(b)) ? 0 : 1;
      return left - right || byOriginalOrder(a, b);
    });
  }
  if (state.achievementSort === 'hidden-first') {
    sorted.sort((a, b) => {
      const left = a.hidden ? 0 : 1;
      const right = b.hidden ? 0 : 1;
      return left - right || byOriginalOrder(a, b);
    });
  }

  return sorted;
}

function getFilteredAchievements() {
  const query = elements.achievementSearch.value.trim().toLowerCase();
  const filtered = state.achievements.filter((achievement) => {
    const draftAchieved = getAchievementDraftState(achievement);
    const matchesQuery = !query ||
      achievement.id.toLowerCase().includes(query) ||
      achievement.displayName.toLowerCase().includes(query) ||
      achievement.description.toLowerCase().includes(query);

    if (!matchesQuery) return false;
    if (state.achievementFilter === 'unlocked') return draftAchieved;
    if (state.achievementFilter === 'locked') return !draftAchieved;
    if (state.achievementFilter === 'changed') return state.pendingAchievements.has(getAchievementKey(achievement));
    if (state.dlcFilter === 'base') return !isDlcAchievement(achievement);
    if (state.dlcFilter === 'dlc') return isDlcAchievement(achievement);
    return true;
  });

  return sortAchievements(filtered);
}

function renderProgress() {
  if (!state.achievements.length) {
    elements.progressSummary.classList.add('hidden');
    return;
  }

  const unlocked = state.achievements.filter((achievement) => getAchievementDraftState(achievement)).length;
  const total = state.achievements.length;
  const percent = total ? Math.round((unlocked / total) * 100) : 0;

  elements.progressText.textContent = getUiLanguage() === 'english'
    ? `${unlocked} / ${total} unlocked`
    : `${unlocked} / ${total} розблоковано`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
  elements.progressSummary.classList.remove('hidden');
}

function getTableSortState(sort) {
  if (sort === 'unlocked-first') {
    return {
      active: state.achievementSort === 'unlocked-first' || state.achievementSort === 'locked-first',
      direction: state.achievementSort === 'locked-first' ? 'asc' : 'desc',
      next: state.achievementSort === 'unlocked-first' ? 'locked-first' : 'unlocked-first',
    };
  }
  if (sort === 'dlc-first') {
    return {
      active: state.achievementSort === 'dlc-first' || state.achievementSort === 'base-first',
      direction: state.achievementSort === 'base-first' ? 'asc' : 'desc',
      next: state.achievementSort === 'dlc-first' ? 'base-first' : 'dlc-first',
    };
  }
  if (sort === 'unlock-time-desc') {
    return {
      active: state.achievementSort === 'unlock-time-desc' || state.achievementSort === 'unlock-time-asc',
      direction: state.achievementSort === 'unlock-time-asc' ? 'asc' : 'desc',
      next: state.achievementSort === 'unlock-time-desc' ? 'unlock-time-asc' : 'unlock-time-desc',
    };
  }
  return {
    active: state.achievementSort === sort,
    direction: 'desc',
    next: state.achievementSort === sort ? 'default' : sort,
  };
}

function renderGames() {
  const query = elements.gameSearch.value.trim().toLowerCase();
  const games = state.games.filter((game) => {
    if (elements.gamesWithAchievementsOnly.checked && !game.hasAchievements) return false;
    const risky = isRiskyGame(game);
    if (state.gameRiskFilter === 'risky' && !risky) return false;
    if (state.gameRiskFilter === 'safe' && risky) return false;
    return !query ||
      game.name.toLowerCase().includes(query) ||
      String(game.appId).includes(query);
  });

  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  games.sort((a, b) => {
    const selectedA = Number(a.appId) === Number(state.selectedGame?.appId) ? 0 : 1;
    const selectedB = Number(b.appId) === Number(state.selectedGame?.appId) ? 0 : 1;
    if (query && selectedA !== selectedB) return selectedA - selectedB;

    if (state.gameSort === 'appid') return Number(a.appId) - Number(b.appId);
    if (state.gameSort === 'achievements-first') {
      const left = a.hasAchievements ? 0 : 1;
      const right = b.hasAchievements ? 0 : 1;
      return left - right || byName(a, b);
    }
    if (state.gameSort === 'risk-first') {
      const left = isRiskyGame(a) ? 0 : 1;
      const right = isRiskyGame(b) ? 0 : 1;
      return left - right || byName(a, b);
    }
    if (state.gameSort === 'issues-first') {
      const left = (isSuspiciousGameName(a.name, a.appId) || !a.icon) ? 0 : 1;
      const right = (isSuspiciousGameName(b.name, b.appId) || !b.icon) ? 0 : 1;
      return left - right || byName(a, b);
    }
    return byName(a, b);
  });

  elements.gameCount.textContent = getUiLanguage() === 'english'
    ? `${games.length} / ${state.games.length} games`
    : `${games.length} / ${state.games.length} ігор`;
  elements.gameList.innerHTML = '';
  if (!games.length) {
    elements.gameList.className = 'game-list empty-state';
    elements.gameList.textContent = t('noGamesFound');
    return;
  }

  elements.gameList.className = 'game-list';
  for (const game of games) {
    const button = document.createElement('button');
    button.className = `game-item ${isRiskyGame(game) ? 'risky' : ''} ${state.selectedGame?.appId === game.appId ? 'active' : ''}`;
    button.innerHTML = `
      ${game.icon ? '<img class="game-icon" alt="" loading="lazy" decoding="async" />' : '<span class="game-icon placeholder" aria-hidden="true"></span>'}
      <span class="game-title">${escapeHtml(game.name)}</span>
      <small><span class="game-appid">${game.appId}</span>${game.hasAchievements ? `<span class="game-mark" title="${escapeHtml(t('achievements'))}">◆</span>` : ''}</small>
    `;
    const icon = button.querySelector('.game-icon');
    if (icon?.tagName === 'IMG') {
      bindRetryingImage(icon, getSteamCdnAlternates(game.icon), 'placeholder');
    }
    button.addEventListener('click', () => selectGame(game));
    elements.gameList.append(button);
  }
}

function renderAchievements() {
  updateAchievementFilterLabels();
  const achievements = getFilteredAchievements();

  const pendingCount = state.pendingAchievements.size;
  const editableCount = state.achievements.filter((achievement) => !isAchievementChangeProtected(achievement)).length;
  elements.achievementCount.textContent = pendingCount
    ? `${achievements.length}/${state.achievements.length} · ${pendingCount} ${getUiLanguage() === 'english' ? 'changes' : 'змін'}`
    : `${achievements.length}/${state.achievements.length}`;
  elements.unlockAllButton.disabled = !state.selectedGame || !editableCount;
  elements.lockAllButton.disabled = !state.selectedGame || !editableCount;
  elements.applyAchievementChangesButton.disabled = !state.selectedGame || pendingCount === 0;
  elements.cancelPendingChangesButton.disabled = pendingCount === 0;
  renderProgress();
  elements.achievementList.innerHTML = '';

  if (!achievements.length) {
    elements.achievementList.className = 'achievement-list empty-state';
    elements.achievementList.textContent = state.selectedGame ? t('noAchievementsAvailable') : t('chooseGameForAchievements');
    return;
  }

  elements.achievementList.className = `achievement-list ${state.achievementViewMode === 'table' ? 'table-mode' : ''}`;
  if (state.achievementViewMode === 'table') {
    const header = document.createElement('div');
    header.className = 'achievement-table-header';
    header.innerHTML = `
      <span></span>
      <span></span>
      <button type="button" data-table-sort="name">${escapeHtml(t('achievements'))}</button>
      <button type="button" data-table-sort="unlocked-first">${escapeHtml(t('unlocked'))}</button>
      <button type="button" data-table-sort="dlc-first">DLC</button>
      <button type="button" data-table-sort="unlock-time-desc">${escapeHtml(t('unlockTime'))}</button>
    `;
    header.querySelectorAll('[data-table-sort]').forEach((button) => {
      const sort = button.dataset.tableSort;
      const sortState = getTableSortState(sort);
      button.classList.toggle('active', sortState.active);
      button.dataset.sortDirection = sortState.direction;
      button.title = getUiLanguage() === 'english'
        ? `Sort by ${button.textContent.trim()}`
        : `Сортувати: ${button.textContent.trim()}`;
      button.addEventListener('click', () => {
        setAchievementSort(sortState.next);
      });
    });
    elements.achievementList.append(header);
  }
  for (const achievement of achievements) {
    const draftAchieved = getAchievementDraftState(achievement);
    const isPending = state.pendingAchievements.has(getAchievementKey(achievement));
    const isProtected = isAchievementChangeProtected(achievement);
    const dlcLabel = isDlcAchievement(achievement)
      ? (achievement.sourceAppName || `DLC ${achievement.sourceAppId || achievement.appId}`)
      : '';
    const row = document.createElement('label');
    row.className = `achievement-row ${draftAchieved ? 'achieved' : ''} ${isPending ? 'pending' : ''} ${isProtected ? 'protected' : ''}`;

    const iconUrls = getAchievementIconUrls(achievement, draftAchieved);
    const image = iconUrls.length
      ? document.createElement('img')
      : createIconPlaceholder('achievement-icon');
    if (iconUrls.length) {
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.className = 'achievement-icon';
      bindRetryingImage(image, iconUrls, 'placeholder');
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = draftAchieved;
    checkbox.disabled = isProtected;
    checkbox.title = isProtected
      ? (getUiLanguage() === 'english' ? 'Steam blocked this achievement from manual changes.' : 'Steam заблокував це досягнення для ручної зміни.')
      : '';
    checkbox.addEventListener('change', () => queueAchievementChange(achievement, checkbox.checked));

    const copy = document.createElement('div');
    copy.className = 'achievement-copy';
    copy.innerHTML = `
      <strong>${escapeHtml(achievement.displayName || achievement.id)}</strong>
      <span>${escapeHtml(achievement.description || achievement.id)}</span>
      ${dlcLabel ? `<em>${escapeHtml(dlcLabel)}</em>` : ''}
      ${achievement.hidden ? '<em>Hidden</em>' : ''}
      ${isProtected ? `<em>${escapeHtml(getUiLanguage() === 'english' ? 'Blocked from Steam changes' : 'Заблоковано для зміни Steam')}</em>` : ''}
    `;
    const status = document.createElement('span');
    status.className = 'achievement-table-cell achievement-status-cell';
    status.textContent = draftAchieved ? t('unlocked') : t('locked');

    const source = document.createElement('span');
    source.className = 'achievement-table-cell';
    source.textContent = dlcLabel || t('baseGame');

    const unlockTime = document.createElement('span');
    unlockTime.className = 'achievement-table-cell';
    unlockTime.textContent = draftAchieved ? formatUnlockTime(achievement) : '—';

    row.append(checkbox, image, copy, status, source, unlockTime);
    elements.achievementList.append(row);
  }
}

function renderStats() {
  renderGameDiagnostics();
  elements.statsCount.textContent = String(state.stats.length || state.statsSchema.length || 0);
  elements.resetStatsButton.disabled = !state.selectedGame || !(state.stats.length || state.statsSchema.length);
  elements.loadStatsButton.disabled = !state.selectedGame;
  elements.steamworksDiagnosticsButton.disabled = !state.selectedGame;
  elements.statsList.innerHTML = '';

  const allStats = state.stats.length ? state.stats : state.statsSchema;
  const query = state.statsFilter.trim().toLowerCase();
  const typeFilter = state.statsTypeFilter || 'all';
  const stats = allStats.filter((stat) => {
    const matchesQuery = !query ||
      String(stat.name || '').toLowerCase().includes(query) ||
      String(stat.displayName || '').toLowerCase().includes(query);
    if (!matchesQuery) return false;

    const editable = stat.readable !== false && stat.writable !== false && stat.type !== 'float';
    const unsupported = stat.readable === false || stat.type === 'float';
    if (typeFilter === 'editable') return editable;
    if (typeFilter === 'readonly') return stat.readable !== false && !editable;
    if (typeFilter === 'unsupported') return unsupported;
    return true;
  });

  if (!stats.length) {
    elements.statsList.className = 'stats-list empty-state';
    elements.statsList.textContent = allStats.length ? t('statsUnavailable') : t('noStatsSchema');
    return;
  }

  elements.statsList.className = 'stats-list';
  const readable = allStats.filter((stat) => stat.readable !== false).length;
  const writable = allStats.filter((stat) => stat.writable !== false && stat.type !== 'float').length;
  const unsupported = allStats.filter((stat) => stat.readable === false || stat.type === 'float').length;
  const summary = document.createElement('div');
  summary.className = 'stats-summary-row';
  summary.innerHTML = `
    <strong>${escapeHtml(t('statsDiagnostics'))}</strong>
    <span>${readable} ${escapeHtml(t('readableStats'))} · ${writable} ${escapeHtml(t('writableStats'))} · ${unsupported} ${escapeHtml(t('unsupportedStats'))}</span>
  `;
  elements.statsList.append(summary);

  for (const stat of stats) {
    const row = document.createElement('div');
    row.className = `stat-row ${stat.readable === false ? 'muted' : ''}`;

    const name = document.createElement('div');
    name.className = 'stat-name';
    const details = [
      stat.name,
      `type: ${stat.type || 'int'}`,
      stat.defaultValue !== undefined ? `default: ${stat.defaultValue}` : '',
      stat.minValue !== null && stat.minValue !== undefined ? `min: ${stat.minValue}` : '',
      stat.maxValue !== null && stat.maxValue !== undefined ? `max: ${stat.maxValue}` : '',
      stat.incrementOnly ? 'increment only' : '',
      stat.error || '',
    ].filter(Boolean).join(' · ');
    name.innerHTML = `<strong>${escapeHtml(stat.displayName || stat.name)}</strong><span>${escapeHtml(details)}</span>`;

    const type = document.createElement('select');
    type.innerHTML = '<option value="int">int</option><option value="float">float</option>';
    type.value = stat.type === 'float' ? 'float' : 'int';

    const input = document.createElement('input');
    input.type = 'number';
    input.step = type.value === 'float' ? '0.01' : '1';
    input.value = stat.value ?? stat.defaultValue ?? 0;
    input.disabled = stat.readable === false || type.value === 'float';

    type.addEventListener('change', () => {
      input.step = type.value === 'float' ? '0.01' : '1';
      input.disabled = type.value === 'float';
      save.disabled = type.value === 'float' || stat.readable === false || stat.writable === false;
    });

    const save = document.createElement('button');
    save.textContent = 'OK';
    save.disabled = stat.readable === false || stat.writable === false || type.value === 'float';
    save.addEventListener('click', () => saveStat(stat.name, type.value, input.value, save));

    row.append(name, type, input, save);
    elements.statsList.append(row);
  }
}

function formatStatus(value) {
  const status = String(value || '');
  const labelsByLanguage = {
    ukrainian: {
      'loaded-local': 'локальний кеш Steam',
      loaded: 'Steam Web API',
      'loaded-global': 'глобальна схема Steam',
      community: 'Steam Community',
      'loaded-web-api': 'Steam Web API',
      'loaded-public': 'публічний профіль Steam',
      'loaded-steamworks-fallback': 'Steamworks',
      'skipped-web-api': 'без Web API',
      unavailable: 'недоступно',
      'missing-profile': 'профіль не визначено',
      empty: 'порожньо',
      'missing-local': 'немає локальної схеми',
    },
    english: {
      'loaded-local': 'local Steam cache',
      loaded: 'Steam Web API',
      'loaded-global': 'global Steam schema',
      community: 'Steam Community',
      'loaded-web-api': 'Steam Web API',
      'loaded-public': 'public Steam profile',
      'loaded-steamworks-fallback': 'Steamworks',
      'skipped-web-api': 'without Web API',
      unavailable: 'unavailable',
      'missing-profile': 'profile not detected',
      empty: 'empty',
      'missing-local': 'no local schema',
    },
  };
  const labels = labelsByLanguage[getUiLanguage()] || labelsByLanguage.english;

  return status
    .split('+')
    .filter(Boolean)
    .map((part) => labels[part] || part)
    .join(' + ') || (getUiLanguage() === 'english' ? 'no data' : 'немає даних');
}

function getProtectedNotice() {
  if (!state.achievements.length) return '';
  const protectedCount = state.achievements.filter(isAchievementChangeProtected).length;
  if (!protectedCount) return '';
  if (protectedCount === state.achievements.length) {
    return `Steam забороняє ручну зміну всіх ${protectedCount} досягнень цієї гри.`;
  }
  return `Steam забороняє ручну зміну ${protectedCount} з ${state.achievements.length} досягнень цієї гри.`;
}

function renderGameDiagnostics() {
  if (!state.selectedGame || !state.diagnostics) {
    elements.gameDiagnostics.className = 'diagnostics-card empty-state';
    elements.gameDiagnostics.textContent = t('diagnosticsEmpty');
    return;
  }

  const diagnostics = {
    ...state.diagnostics,
    name: state.selectedGame.name,
    appId: state.selectedGame.appId,
    source: state.selectedGame.source || state.diagnostics.source || 'local',
    iconCached: String(state.selectedGame.icon || '').startsWith('file:') || Boolean(state.diagnostics.iconCached),
    suspiciousName: isSuspiciousGameName(state.selectedGame.name, state.selectedGame.appId),
    risky: isRiskyGame(state.selectedGame),
  };
  const lang = getUiLanguage();
  const isEnglish = lang === 'english';
  const protectedText = diagnostics.protectedAchievements
    ? (isEnglish ? `${diagnostics.protectedAchievements} blocked by Steam` : `${diagnostics.protectedAchievements} заблоковано Steam`)
    : (isEnglish ? 'no Steam lock' : 'немає Steam-блокування');
  const steamworks = state.steamworksDiagnostics;
  const steamworksText = steamworks
    ? (steamworks.error
      ? (isEnglish ? `error: ${steamworks.error}` : `помилка: ${steamworks.error}`)
      : `AppID ${steamworks.activeAppId || diagnostics.appId} · ${steamworks.installed ? (isEnglish ? 'installed' : 'встановлено') : (isEnglish ? 'not installed' : 'не встановлено')} · ${steamworks.currentLanguage || '-'}`)
    : (isEnglish ? 'not checked yet' : 'ще не перевірено');

  elements.gameDiagnostics.className = 'diagnostics-card';
  elements.gameDiagnostics.innerHTML = `
    <div class="diagnostics-head">
      <strong>${escapeHtml(t('diagnosticsTitle'))}</strong>
      <span>${escapeHtml(diagnostics.name)} · AppID ${escapeHtml(diagnostics.appId)}</span>
    </div>
    <div class="diagnostics-grid">
      <div><span>${isEnglish ? 'Achievement list' : 'Список досягнень'}</span><strong>${escapeHtml(formatStatus(diagnostics.schemaStatus))}</strong></div>
      <div><span>${isEnglish ? 'Checkbox state' : 'Стан галочок'}</span><strong>${escapeHtml(formatStatus(diagnostics.stateStatus))}</strong></div>
      <div><span>${escapeHtml(t('achievements'))}</span><strong>${diagnostics.achievements || 0} ${isEnglish ? 'total' : 'всього'} · ${diagnostics.baseAchievements || 0} ${escapeHtml(t('baseGame').toLowerCase())} · ${diagnostics.dlcAchievements || 0} DLC</strong></div>
      <div><span>DLC ${isEnglish ? 'from Steam Store' : 'зі Steam Store'}</span><strong>${diagnostics.dlcCandidates || 0} ${isEnglish ? 'found' : 'знайдено'} · ${diagnostics.dlcGroups || 0} ${isEnglish ? 'with achievements' : 'з досягненнями'}</strong></div>
      <div><span>${isEnglish ? 'Lock' : 'Блокування'}</span><strong>${escapeHtml(protectedText)}</strong></div>
      <div><span>${isEnglish ? 'Steamworks helper' : 'Steamworks-помічник'}</span><strong>${escapeHtml(steamworksText)}</strong></div>
      <div><span>${isEnglish ? 'Icon / name' : 'Іконки / назва'}</span><strong>${diagnostics.iconCached ? (isEnglish ? 'local cache icon' : 'іконка з локального кешу') : (isEnglish ? 'network icon' : 'іконка з мережі')} · ${diagnostics.suspiciousName ? (isEnglish ? 'suspicious name' : 'назва підозріла') : (isEnglish ? 'name looks normal' : 'назва виглядає нормально')}</strong></div>
      <div><span>${escapeHtml(t('risk'))}</span><strong>${diagnostics.risky ? (isEnglish ? 'online/VAC or anti-cheat sensitive game' : 'онлайн/VAC або античіт-чутлива гра') : (isEnglish ? 'no special risk marker' : 'без спеціальної позначки ризику')}</strong></div>
      <div><span>${isEnglish ? 'Stats' : 'Статистика'}</span><strong>${diagnostics.stats || 0}</strong></div>
    </div>
  `;
}

function renderHistory() {
  elements.historyCount.textContent = String(state.history.length);
  elements.historyList.innerHTML = '';

  if (!state.history.length) {
    elements.historyList.className = 'history-list empty-state';
    elements.historyList.textContent = t('historyEmpty');
    return;
  }

  elements.historyList.className = 'history-list';
  for (const entry of state.history) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    const changed = Array.isArray(entry.changed) ? entry.changed : [];
    const failed = Array.isArray(entry.failed) ? entry.failed : [];
    const unlocks = changes.filter((change) => change.achieved).length;
    const locks = changes.length - unlocks;
    const when = entry.createdAt ? new Date(entry.createdAt).toLocaleString('uk-UA') : '';
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <strong>${escapeHtml(entry.game?.name || 'Steam game')} (${escapeHtml(entry.game?.appId || '')})</strong>
      <span>${escapeHtml(when)} · розблокувати: ${unlocks} · заблокувати: ${locks} · застосовано: ${changed.length} · помилок: ${failed.length}</span>
      ${entry.backupPath ? `<small>Backup: ${escapeHtml(entry.backupPath)}</small>` : ''}
      ${entry.backupPath ? '<div class="history-actions"><button type="button" data-action="compare">Порівняти</button><button type="button" data-action="restore">Відновити</button></div>' : ''}
    `;
    const compareButton = row.querySelector('[data-action="compare"]');
    const restoreButton = row.querySelector('[data-action="restore"]');
    if (compareButton) compareButton.addEventListener('click', () => compareBackup(entry.backupPath));
    if (restoreButton) restoreButton.addEventListener('click', () => restoreBackup(entry.backupPath));
    elements.historyList.append(row);
  }
}

function renderSelection() {
  elements.selectedGame.textContent = state.selectedGame?.name || t('chooseGame');
  elements.selectedAppId.textContent = state.selectedGame ? `AppID ${state.selectedGame.appId}` : t('noGameSelectedMeta');
  elements.openSteamButton.disabled = !state.selectedGame;
  elements.refreshGameButton.disabled = !state.selectedGame;
  renderGames();
  renderAchievements();
  renderStats();
  renderHistory();
}

async function loadStatusAndGames() {
  setBusy(elements.refreshButton, true);
  setLoading('Оновлення Steam', 'Перевіряю клієнт Steam і поточний профіль...');
  showNotice('');
  try {
    const status = await window.sam.getStatus();
    state.settings = status.settings || state.settings;
    state.activeProfileId = status.settings?.profileId || status.profile?.steamId64 || '';
    state.activePersona = status.profile?.persona || status.settings?.persona || '';
    elements.apiKeyInput.value = state.settings.apiKey || '';
    setLanguageValue(state.settings.language);
    setThemeValue(state.settings.theme);
    setScaleValue(state.settings.uiScale);
    state.gameSort = pickAllowed(state.settings.gameSort, ALLOWED_GAME_SORTS, 'name');
    elements.gameSort.value = state.gameSort;
    applyAppearance();
    applyUiLanguage();

    if (status.steamRunning && status.profile?.persona) {
      elements.steamStatus.textContent = `Steam: ${status.profile.persona}`;
    } else if (status.steamRunning) {
      elements.steamStatus.textContent = 'Steam: запущено';
      if (status.profile?.error) showNotice(status.profile.error, 'warning');
    } else {
      elements.steamStatus.textContent = 'Steam: не запущено';
      showNotice('Запустіть Steam і увійдіть в акаунт перед зміною досягнень.', 'warning');
    }

    setLoading('Оновлення списку ігор', 'Читаю локальну бібліотеку, кеш Steam і, якщо доступно, Web API...');
    state.games = await window.sam.listGames({
      apiKey: elements.apiKeyInput.value.trim(),
    });
    setLoading('Підготовка інтерфейсу', `Знайдено ігор: ${state.games.length}. Оновлюю список і фільтри...`);
    await loadHistory({ silent: true });
    renderGames();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setLoading('');
    setBusy(elements.refreshButton, false);
  }
}

function formatGameListForNotice(items, label) {
  const rows = (items || []).slice(0, 5).map((item) => `${item.name} (${item.appId})`);
  if (!rows.length) return `${label}: немає`;
  const more = items.length > rows.length ? `, ще ${items.length - rows.length}` : '';
  return `${label}: ${rows.join(', ')}${more}`;
}

async function runLibraryDiagnostics() {
  setBusy(elements.libraryDiagnosticsButton, true);
  setLoading('Перевірка бібліотеки', 'Перевіряю локальні схеми, іконки, назви, DLC та Steam-блокування...');
  try {
    const report = await window.sam.diagnoseLibrary();
    const lines = [
      `Перевірено ${report.totalGames || 0} ігор, з досягненнями: ${report.withAchievements || 0}.`,
      formatGameListForNotice(report.suspiciousNames || [], 'Підозрілі назви'),
      formatGameListForNotice(report.missingIcons || [], 'Без іконок'),
      formatGameListForNotice(report.protectedGames || [], 'Steam блокує зміну'),
      formatGameListForNotice(report.dlcGames || [], 'Є DLC-позначки'),
    ];
    showNotice(lines.join(' '), 'info');
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setLoading('');
    setBusy(elements.libraryDiagnosticsButton, false);
  }
}

async function loadHistory({ silent = false } = {}) {
  try {
    state.history = await window.sam.getHistory();
    renderHistory();
  } catch (error) {
    if (!silent) showNotice(error.message, 'error');
  }
}

async function refreshSelectedGame() {
  if (!state.selectedGame) return;
  if (state.pendingAchievements.size && !window.confirm('Скасувати підготовлені зміни й оновити поточну гру?')) {
    return;
  }
  await selectGame(state.selectedGame, { force: true });
}

function getGameCacheKey(game) {
  return [
    Number(game?.appId || 0),
    elements.languageInput.value || 'ukrainian',
    state.activeProfileId || 'no-profile',
    elements.apiKeyInput.value.trim() || 'no-api',
  ].join(':');
}

function getStateNotice(stateStatus, hasAchievements) {
  if (!hasAchievements) return '';
  const status = String(stateStatus || '');
  if (status === 'missing-profile') {
    return 'Не вдалося визначити поточний Steam-акаунт. Відкрийте Steam і натисніть оновлення.';
  }
  if (status === 'skipped-web-api') {
    return 'Список досягнень завантажено без запуску гри через Steamworks. Щоб бачити точний стан галочок без позначки "грає", додайте Steam Web API key або відкрийте профіль.';
  }
  if (status === 'unavailable') {
    return 'Не вдалося прочитати поточний стан галочок без запуску гри через Steamworks. Додайте Steam Web API key або відкрийте профіль, щоб бачити точний стан.';
  }
  return '';
}

function applyLoadedGameResult(result) {
  setAchievementsState((result.achievements || []).map((achievement, order) => ({ ...achievement, order })));
  state.statsSchema = result.stats || [];
  state.diagnostics = {
    ...(result.diagnostics || {}),
    schemaStatus: result.schemaStatus,
    stateStatus: result.stateStatus,
    achievements: (result.achievements || []).length,
    baseAchievements: (result.achievements || []).filter((achievement) => !isDlcAchievement(achievement)).length,
    dlcAchievements: (result.achievements || []).filter(isDlcAchievement).length,
    dlcCandidates: Number(result.dlcCount || 0),
    dlcLoaded: Number(result.dlcAchievementCount || 0),
    dlcGroups: Number(result.diagnostics?.dlcGroups || getDlcGroupCount(result.achievements || [])),
    protectedAchievements: (result.achievements || []).filter((achievement) => achievement.changeProtected).length,
    stats: (result.stats || []).length,
  };
  return getSchemaNotice(result.schemaStatus, state.achievements.length > 0) ||
    getStateNotice(result.stateStatus, state.achievements.length > 0) ||
    getProtectedNotice();
}

async function selectGame(game, { force = false } = {}) {
  state.selectedGame = game;
  setAchievementsState([]);
  state.pendingAchievements.clear();
  state.statsSchema = [];
  state.stats = [];
  state.diagnostics = null;
  state.steamworksDiagnostics = null;
  renderSelection();

  const cacheKey = getGameCacheKey(game);
  const cached = force ? null : getGameCacheEntry(cacheKey);
  if (cached) {
    const notice = applyLoadedGameResult(cached);
    const riskNotice = isRiskyGame(game)
      ? 'Увага: це онлайн/VAC або античіт-чутлива гра. Змінюйте досягнення тільки якщо розумієте ризики.'
      : '';
    showNotice(notice || riskNotice, notice || riskNotice ? 'warning' : 'info');
    renderSelection();
    return;
  }

  if (force) state.gameCache.delete(cacheKey);
  const loadToken = ++state.loadToken;
  setLoading('Завантаження досягнень', `${game.name}: читаю Steam schema, DLC і статуси досягнень...`);
  showNotice('Завантаження даних гри...');

  try {
    const result = await window.sam.loadGame({
      appId: game.appId,
      apiKey: elements.apiKeyInput.value.trim(),
      language: elements.languageInput.value || 'ukrainian',
      steamId64: state.activeProfileId,
    });
    if (loadToken !== state.loadToken || Number(state.selectedGame?.appId) !== Number(game.appId)) return;

    setGameCacheEntry(cacheKey, result);
    setLoading('Підготовка списку', `${game.name}: застосовую фільтри, назви та іконки...`);
    const notice = applyLoadedGameResult(result);
    const riskNotice = isRiskyGame(game)
      ? 'Увага: це онлайн/VAC або античіт-чутлива гра. Змінюйте досягнення тільки якщо розумієте ризики.'
      : '';
    showNotice(notice || riskNotice, notice || riskNotice ? 'warning' : 'info');
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    if (loadToken === state.loadToken) setLoading('');
    renderSelection();
  }
}

function cancelPendingChanges() {
  if (!state.pendingAchievements.size) return;
  state.pendingAchievements.clear();
  renderAchievements();
  showNotice('Підготовлені зміни скасовано.');
}

function queueAchievementChange(achievement, achieved) {
  if (isAchievementChangeProtected(achievement)) {
    showNotice('Steam заблокував це досягнення для ручної зміни.', 'warning');
    return;
  }
  setPendingAchievement(achievement, achieved);
  renderAchievements();
  showNotice(state.pendingAchievements.size
    ? `Підготовлено змін: ${state.pendingAchievements.size}. Натисніть ✓, щоб відправити їх у Steam.`
    : '');
}

function setAllAchievements(achieved) {
  if (!state.selectedGame || !state.achievements.length) return;
  const visibleAchievements = getFilteredAchievements();
  const editableAchievements = visibleAchievements.filter((achievement) => !isAchievementChangeProtected(achievement));
  if (!editableAchievements.length) {
    showNotice('Немає видимих досягнень, які Steam дозволяє змінювати вручну.', 'warning');
    return;
  }

  for (const achievement of editableAchievements) {
    setPendingAchievement(achievement, achieved);
  }

  renderAchievements();
  showNotice(`${editableAchievements.length} видимих досягнень позначено для ${achieved ? 'розблокування' : 'блокування'}. Натисніть ✓, щоб підтвердити.`);
}

function getAchievementByKey(key) {
  return state.achievementByKey.get(key);
}

function getAchievementNameByKey(key) {
  const achievement = getAchievementByKey(key);
  return achievement?.displayName || achievement?.id || key;
}

function getBackupAchievementKey(achievement, backup) {
  const appId = Number(achievement?.appId || achievement?.sourceAppId || backup?.game?.appId || state.selectedGame?.appId || 0);
  return `${appId}:${achievement?.id || ''}`;
}

function getChangeKey(change) {
  const appId = Number(change?.appId || state.selectedGame?.appId || 0);
  return `${appId}:${change?.id || ''}`;
}

function getAchievementSnapshot() {
  return state.achievements.map((achievement) => ({
    appId: Number(achievement.appId || state.selectedGame?.appId || 0),
    sourceAppId: Number(achievement.sourceAppId || achievement.appId || state.selectedGame?.appId || 0),
    sourceAppName: achievement.sourceAppName || '',
    isDlc: isDlcAchievement(achievement),
    id: achievement.id,
    displayName: achievement.displayName || achievement.id,
    description: achievement.description || '',
    hidden: Boolean(achievement.hidden),
    changeProtected: Boolean(achievement.changeProtected),
    achieved: Boolean(achievement.achieved),
    unlockTime: Number(achievement.unlockTime || 0),
  }));
}

function getDetailedChanges() {
  return [...state.pendingAchievements.entries()]
    .map(([key, achieved]) => {
      const achievement = getAchievementByKey(key);
      const separator = key.indexOf(':');
      const fallbackAppId = Number(separator >= 0 ? key.slice(0, separator) : state.selectedGame?.appId || 0);
      const fallbackId = separator >= 0 ? key.slice(separator + 1) : key;
      return {
        appId: Number(achievement?.appId || fallbackAppId),
        id: achievement?.id || fallbackId,
        achieved,
        displayName: getAchievementNameByKey(key),
        sourceAppName: achievement?.sourceAppName || '',
      };
    })
    .filter((change) => Number.isInteger(change.appId) && change.appId > 0 && change.id);
}

function formatConfirmList(title, changes) {
  if (!changes.length) return '';
  const visible = changes.slice(0, 12).map((change) => (
    `- ${change.displayName}${change.sourceAppName ? ` (${change.sourceAppName})` : ''}`
  ));
  const hiddenCount = changes.length - visible.length;
  return `${title} (${changes.length}):\n${visible.join('\n')}${hiddenCount > 0 ? `\n...і ще ${hiddenCount}` : ''}`;
}

function translateFailureReason(reason) {
  const text = String(reason || '');
  if (text.includes('Steam rejected the change after stats were loaded')) {
    return 'Steam завантажив статистику, але відхилив зміну.';
  }
  if (text.includes('Steam does not see this achievement API name')) {
    return 'Steam не бачить це досягнення у поточній сесії.';
  }
  if (text.includes('Steam API could not initialize')) {
    return 'Steam API не вдалося запустити для цієї гри.';
  }
  if (text.includes('Steam did not return the user stats interface')) {
    return 'Steam не повернув модуль статистики для цієї гри.';
  }
  return text || 'Steam відхилив зміну.';
}

function formatFailureDetails(failed) {
  const visible = failed.slice(0, 3).map((change) => {
    const name = getAchievementNameByKey(getChangeKey(change));
    const reason = translateFailureReason(change.reason);
    return `${name}: ${reason}`;
  });
  const hiddenCount = failed.length - visible.length;
  return `${visible.join(' · ')}${hiddenCount > 0 ? ` · і ще ${hiddenCount}` : ''}`;
}

async function loadBackupForCurrentState(backupPath) {
  const backup = await window.sam.readAchievementBackup(backupPath);
  const appId = Number(backup.game?.appId);
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error('Backup does not contain a valid AppID.');
  }

  if (!state.selectedGame || Number(state.selectedGame.appId) !== appId || !state.achievements.length) {
    const game = state.games.find((item) => Number(item.appId) === appId) || {
      appId,
      name: backup.game?.name || `App ${appId}`,
    };
    await selectGame(game);
  }

  return backup;
}

function getBackupDifferences(backup) {
  const backupById = new Map((backup.achievements || []).map((achievement) => [getBackupAchievementKey(achievement, backup), achievement]));
  return state.achievements
    .map((achievement) => {
      const saved = backupById.get(getAchievementKey(achievement));
      if (!saved || Boolean(saved.achieved) === Boolean(achievement.achieved)) return null;
      return {
        key: getAchievementKey(achievement),
        appId: Number(achievement.appId || state.selectedGame?.appId || 0),
        id: achievement.id,
        displayName: achievement.displayName || saved.displayName || achievement.id,
        sourceAppName: achievement.sourceAppName || saved.sourceAppName || '',
        current: Boolean(achievement.achieved),
        backup: Boolean(saved.achieved),
      };
    })
    .filter(Boolean);
}

async function compareBackup(backupPath) {
  try {
    const backup = await loadBackupForCurrentState(backupPath);
    const differences = getBackupDifferences(backup);
    const visible = differences.slice(0, 20).map((item) => {
      const direction = item.backup ? 'має бути розблоковано' : 'має бути заблоковано';
      return `- ${item.displayName}: ${direction}`;
    });
    window.alert(differences.length
      ? `Відмінностей з backup: ${differences.length}\n\n${visible.join('\n')}${differences.length > visible.length ? `\n...і ще ${differences.length - visible.length}` : ''}`
      : 'Поточний стан збігається з цим backup.');
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function restoreBackup(backupPath) {
  try {
    const backup = await loadBackupForCurrentState(backupPath);
    const differences = getBackupDifferences(backup);
    if (!differences.length) {
      showNotice('Поточний стан уже збігається з цим backup.');
      return;
    }

    const confirmed = window.confirm(
      `Підготувати відновлення з backup для гри "${backup.game?.name || state.selectedGame.name}"?\n\nЗмін буде підготовлено: ${differences.length}\n\nЗміни не будуть відправлені в Steam автоматично. Після цього натисніть ✓ для підтвердження.`
    );
    if (!confirmed) return;

    state.pendingAchievements.clear();
    const byKey = new Map(state.achievements.map((achievement) => [getAchievementKey(achievement), achievement]));
    for (const difference of differences) {
      const achievement = byKey.get(difference.key);
      if (achievement) setPendingAchievement(achievement, difference.backup);
    }

    renderAchievements();
    showNotice(`Відновлення підготовлено: ${state.pendingAchievements.size} змін. Натисніть ✓, щоб застосувати.`);
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function applyAchievementChanges() {
  if (!state.selectedGame || !state.pendingAchievements.size) return;

  const detailedChanges = getDetailedChanges();
  const blockedChanges = detailedChanges.filter((change) => isAchievementChangeProtected(getAchievementByKey(getChangeKey(change))));
  if (blockedChanges.length) {
    for (const change of blockedChanges) {
      state.pendingAchievements.delete(getChangeKey(change));
    }
    renderAchievements();
    showNotice('Steam заблокував ці досягнення для ручної зміни. Я прибрав їх із черги.', 'warning');
    return;
  }
  const changes = detailedChanges.map(({ appId, id, achieved }) => ({ appId, id, achieved }));
  const unlockCount = changes.filter((change) => change.achieved).length;
  const lockCount = changes.length - unlockCount;
  const unlockList = formatConfirmList('Розблокувати', detailedChanges.filter((change) => change.achieved));
  const lockList = formatConfirmList('Заблокувати', detailedChanges.filter((change) => !change.achieved));
  const confirmed = window.confirm(
    `Підтвердити зміни для гри "${state.selectedGame.name}"?\n\nРозблокувати: ${unlockCount}\nЗаблокувати: ${lockCount}\n\n${[unlockList, lockList].filter(Boolean).join('\n\n')}\n\nПеред змінами буде створено backup. Після підтвердження зміни буде відправлено в Steam.`
  );

  if (!confirmed) return;

  setBusy(elements.applyAchievementChangesButton, true);
  elements.unlockAllButton.disabled = true;
  elements.lockAllButton.disabled = true;
  showNotice('Створення backup перед змінами...');

  try {
    const backup = await window.sam.createAchievementBackup({
      game: {
        appId: state.selectedGame.appId,
        name: state.selectedGame.name,
      },
      achievements: getAchievementSnapshot(),
      changes: detailedChanges,
    });

    showNotice('Відправлення змін у Steam...');
    const result = await window.sam.applyAchievementChanges({
      appId: state.selectedGame.appId,
      changes,
    });

    const changed = Array.isArray(result.changed) ? result.changed : [];
    const failed = Array.isArray(result.failed) ? result.failed : [];
    const changedByKey = new Map(changed.map((change) => [getChangeKey(change), change.achieved]));
    const appliedAt = Math.floor(Date.now() / 1000);

    setAchievementsState(state.achievements.map((achievement) => {
      const nextAchieved = changedByKey.get(getAchievementKey(achievement));
      if (nextAchieved === undefined) return achievement;
      return {
        ...achievement,
        achieved: nextAchieved,
        unlockTime: nextAchieved ? appliedAt : 0,
      };
    }));

    for (const change of changed) {
      state.pendingAchievements.delete(getChangeKey(change));
    }
    for (const change of failed) {
      state.pendingAchievements.delete(getChangeKey(change));
    }

    if (state.selectedGame) {
      const cacheKey = getGameCacheKey(state.selectedGame);
      const cached = getGameCacheEntry(cacheKey);
      if (cached) {
        setGameCacheEntry(cacheKey, {
          ...cached,
          achievements: state.achievements.map((achievement) => ({ ...achievement })),
        });
      }
    }

    await window.sam.recordHistory({
      game: {
        appId: state.selectedGame.appId,
        name: state.selectedGame.name,
      },
      changes: detailedChanges,
      changed,
      failed,
      backupPath: backup.path,
    });
    await loadHistory({ silent: true });

    if (failed.length) {
      const details = formatFailureDetails(failed);
      showNotice(`Готово частково: застосовано ${changed.length}, не вдалося застосувати ${failed.length}. ${details} Backup: ${backup.path}`, 'warning');
    } else {
      showNotice(`Зміни застосовано: ${changed.length}. Backup: ${backup.path}`, 'success');
    }
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setBusy(elements.applyAchievementChangesButton, false);
    renderAchievements();
  }
}

async function loadStats() {
  if (!state.selectedGame) return;
  setBusy(elements.loadStatsButton, true);
  try {
    state.stats = await window.sam.readStats({
      appId: state.selectedGame.appId,
      stats: state.statsSchema,
    });
    showNotice('');
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setBusy(elements.loadStatsButton, false);
    renderStats();
  }
}

async function runSteamworksDiagnostics() {
  if (!state.selectedGame) return;
  setBusy(elements.steamworksDiagnosticsButton, true);
  try {
    state.steamworksDiagnostics = await window.sam.diagnoseSteamworks({
      appId: state.selectedGame.appId,
    });
    showNotice(getUiLanguage() === 'english' ? 'Steamworks check completed.' : 'Перевірку Steamworks завершено.', 'success');
  } catch (error) {
    state.steamworksDiagnostics = { error: error.message };
    showNotice(error.message, 'error');
  } finally {
    setBusy(elements.steamworksDiagnosticsButton, false);
    renderStats();
  }
}

async function saveStat(name, type, value, button) {
  if (!state.selectedGame) return;
  setBusy(button, true);
  try {
    await window.sam.setStat({
      appId: state.selectedGame.appId,
      name,
      type,
      value,
    });
    showNotice(`Статистику збережено: ${name}`, 'success');
    await loadStats();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function resetStats() {
  if (!state.selectedGame) return;
  const confirmed = window.confirm(
    getUiLanguage() === 'english'
      ? `Reset Steam stats for "${state.selectedGame.name}"?\n\nAchievements will not be reset, but in-game stat values may change permanently.`
      : `Скинути статистику Steam для "${state.selectedGame.name}"?\n\nДосягнення не будуть скинуті, але значення внутрішньоігрової статистики можуть змінитися назавжди.`
  );
  if (!confirmed) return;

  setBusy(elements.resetStatsButton, true);
  try {
    await window.sam.resetStats({ appId: state.selectedGame.appId });
    showNotice(getUiLanguage() === 'english' ? 'Stats reset. Reloading current values...' : 'Статистику скинуто. Оновлюю поточні значення...', 'success');
    await loadStats();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setBusy(elements.resetStatsButton, false);
  }
}

async function saveSettings({ silent = false } = {}) {
  setBusy(elements.saveSettingsButton, true);
  try {
    state.settings = await window.sam.saveSettings({
      apiKey: elements.apiKeyInput.value,
      language: elements.languageInput.value || 'ukrainian',
      theme: elements.themeInput.value || 'dark',
      uiScale: elements.uiScaleInput.value || 'compact',
      gameSort: state.gameSort || 'name',
      profileId: state.activeProfileId,
      persona: state.activePersona,
    });
    applyAppearance();
    applyUiLanguage();
    if (!silent) showNotice(state.activeProfileId ? 'Налаштування збережено для поточного Steam-акаунта.' : 'Налаштування збережено.', 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    setBusy(elements.saveSettingsButton, false);
  }
}

async function changeLanguage() {
  await saveSettings({ silent: true });
  applyUiLanguage();
  if (state.selectedGame) {
    await selectGame(state.selectedGame, { force: true });
  }
}

async function openSelectedSteamPage() {
  if (!state.selectedGame) return;
  try {
    await window.sam.openSteamPage(state.selectedGame.appId);
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function openBackupsFolder() {
  try {
    await window.sam.openBackupsFolder();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function toggleAppearancePanel() {
  elements.appearancePanel.classList.toggle('hidden');
}

document.addEventListener('click', (event) => {
  if (elements.appearancePanel.classList.contains('hidden')) return;
  if (elements.appearancePanel.contains(event.target) || elements.appearanceSettingsButton.contains(event.target)) return;
  elements.appearancePanel.classList.add('hidden');
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    state.activeTab = button.dataset.tab;
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
    document.querySelector(`#${state.activeTab}Panel`).classList.add('active');
  });
});

document.querySelectorAll('.filter-chip').forEach((button) => {
  button.addEventListener('click', () => {
    if (!button.dataset.achievementFilter) return;
    applyAchievementStatusFilter(button.dataset.achievementFilter || 'all');
  });
});

document.querySelectorAll('.source-chip').forEach((button) => {
  button.addEventListener('click', () => {
    applyAchievementSourceFilter(button.dataset.dlcFilter || 'all');
  });
});

elements.refreshButton.addEventListener('click', loadStatusAndGames);
elements.libraryDiagnosticsButton.addEventListener('click', runLibraryDiagnostics);
elements.gameSearch.addEventListener('input', renderGames);
elements.gamesWithAchievementsOnly.addEventListener('change', renderGames);
elements.gameRiskFilter.addEventListener('change', () => {
  state.gameRiskFilter = elements.gameRiskFilter.value || 'all';
  renderGames();
});
elements.gameSort.addEventListener('change', () => {
  state.gameSort = elements.gameSort.value || 'name';
  renderGames();
  saveSettings({ silent: true });
});
elements.openSteamButton.addEventListener('click', openSelectedSteamPage);
elements.refreshGameButton.addEventListener('click', refreshSelectedGame);
elements.achievementSearch.addEventListener('input', debounce(renderAchievements, 150));
elements.unlockAllButton.addEventListener('click', () => setAllAchievements(true));
elements.lockAllButton.addEventListener('click', () => setAllAchievements(false));
elements.applyAchievementChangesButton.addEventListener('click', applyAchievementChanges);
elements.cancelPendingChangesButton.addEventListener('click', cancelPendingChanges);
elements.loadStatsButton.addEventListener('click', loadStats);
elements.resetStatsButton.addEventListener('click', resetStats);
elements.steamworksDiagnosticsButton.addEventListener('click', runSteamworksDiagnostics);
elements.statsSearch.addEventListener('input', () => {
  state.statsFilter = elements.statsSearch.value || '';
  renderStats();
});
elements.statsTypeFilter.addEventListener('change', () => {
  state.statsTypeFilter = elements.statsTypeFilter.value || 'all';
  renderStats();
});
elements.refreshHistoryButton.addEventListener('click', () => loadHistory());
elements.openBackupsFolderButton.addEventListener('click', openBackupsFolder);
elements.saveSettingsButton.addEventListener('click', saveSettings);
elements.languageInput.addEventListener('change', changeLanguage);
elements.appearanceSettingsButton.addEventListener('click', toggleAppearancePanel);
elements.themeInput.addEventListener('change', () => {
  applyAppearance();
  saveSettings({ silent: true });
});
elements.uiScaleInput.addEventListener('change', () => {
  applyAppearance();
  saveSettings({ silent: true });
});

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppearance);
}

applyUiLanguage();
loadStatusAndGames();
