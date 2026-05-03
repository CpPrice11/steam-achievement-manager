const FAR_CRY_6_DLC_BY_ACHIEVEMENT = new Map([
  ['FC6_Ach_75', 'Party Crasher'],
  ['FC6_Ach_93', 'Party Crasher'],
  ['FC6_Ach_51', 'Vaas: Insanity'],
  ['FC6_Ach_36', 'Vaas: Insanity'],
  ['FC6_Ach_61', 'Vaas: Insanity'],
  ['FC6_Ach_92', 'Vaas: Insanity'],
  ['FC6_Ach_25', 'Vaas: Insanity'],
  ['FC6_Ach_84', 'Vaas: Insanity'],
  ['FC6_Ach_66', 'Vaas: Insanity'],
  ['FC6_Ach_65', 'Vaas: Insanity'],
  ['FC6_Ach_74', 'Vaas: Insanity'],
  ['FC6_Ach_68', 'Vaas: Insanity'],
  ['FC6_Ach_85', 'Salt of the Earth'],
  ['FC6_Ach_99', 'Salt of the Earth'],
  ['FC6_Ach_87', 'Salt of the Earth'],
  ['FC6_Ach_69', 'Pagan: Control'],
  ['FC6_Ach_96', 'Pagan: Control'],
  ['FC6_Ach_80', 'Pagan: Control'],
  ['FC6_Ach_90', 'Pagan: Control'],
  ['FC6_Ach_89', 'Pagan: Control'],
  ['FC6_Ach_67', 'Pagan: Control'],
  ['FC6_Ach_56', 'Pagan: Control'],
  ['FC6_Ach_88', 'Pagan: Control'],
  ['FC6_Ach_83', 'Pagan: Control'],
  ['FC6_Ach_86', 'Pagan: Control'],
  ['FC6_Ach_79', 'Joseph: Collapse'],
  ['FC6_Ach_71', 'Joseph: Collapse'],
  ['FC6_Ach_28', 'Joseph: Collapse'],
  ['FC6_Ach_82', 'Joseph: Collapse'],
  ['FC6_Ach_77', 'Joseph: Collapse'],
  ['FC6_Ach_64', 'Joseph: Collapse'],
  ['FC6_Ach_54', 'Joseph: Collapse'],
  ['FC6_Ach_78', 'Joseph: Collapse'],
  ['FC6_Ach_58', 'Joseph: Collapse'],
  ['FC6_Ach_76', 'Joseph: Collapse'],
  ['FC6_Ach_73', 'Lost Between Worlds'],
  ['FC6_Ach_72', 'Lost Between Worlds'],
  ['FC6_Ach_52', 'Lost Between Worlds'],
  ['FC6_Ach_62', 'Lost Between Worlds'],
  ['FC6_Ach_57', 'Lost Between Worlds'],
  ['FC6_Ach_95', 'Lost Between Worlds'],
  ['FC6_Ach_94', 'Lost Between Worlds'],
  ['FC6_Ach_70', 'Lost Between Worlds'],
  ['FC6_Ach_97', 'Lost Between Worlds'],
  ['FC6_Ach_53', 'Lost Between Worlds'],
  ['FC6_Ach_55', 'Lost Between Worlds'],
]);

const BIO_SHOCK_INFINITE_DLC_RANGES = [
  { from: 51, to: 60, name: 'Clash in the Clouds' },
  { from: 61, to: 70, name: 'Burial at Sea - Episode 1' },
  { from: 71, to: 80, name: 'Burial at Sea - Episode 2' },
];

const BLACK_OPS_2_ZOMBIES_DLC_BY_NUMBER = new Map([
  ['1', 'Revolution / Die Rise'],
  ['2', 'Uprising / Mob of the Dead'],
  ['3', 'Vengeance / Buried'],
  ['4', 'Apocalypse / Origins'],
]);

const GRAVEYARD_KEEPER_DLC_BY_PREFIX = new Map([
  ['dlc_stories_', 'Stranger Sins'],
  ['dlc_refugees_', 'Game of Crone'],
  ['dlc_souls_', 'Better Save Soul'],
]);

const DLC_PREFIX_RULES_BY_APP = new Map([
  [924970, [
    [/^Achievement_DLC1_/i, 'Tunnels of Terror'],
    [/^Achievement_DLC2_/i, 'Children of the Worm'],
    [/^Achievement_DLC3_/i, 'River of Blood'],
  ]],
  [238090, [
    [/^SNIPER3_REWARD_DLC0?1_/i, 'Hunt the Grey Wolf'],
    [/^SNIPER3_REWARD_DLC0?2_/i, 'In Shadows'],
    [/^SNIPER3_REWARD_DLC0?3_/i, 'Belly of the Beast'],
    [/^SNIPER3_REWARD_DLC0?4_/i, 'Confrontation'],
    [/^SNIPER3_REWARD_DLC0?5_/i, 'Shooting Range'],
  ]],
  [305620, [
    [/^DLC01_/i, 'Tales from the Far Territory'],
  ]],
  [475550, [
    [/^dlc_/i, 'Blissful Sleep'],
  ]],
]);

function getBioShockInfiniteDlcSource(id) {
  const match = String(id || '').match(/^achievement_(\d+)$/i);
  if (!match) return '';

  const number = Number(match[1]);
  return BIO_SHOCK_INFINITE_DLC_RANGES.find((range) => number >= range.from && number <= range.to)?.name || '';
}

function getBlackOps2ZombiesDlcSource(id) {
  const match = String(id || '').match(/^ZM_DLC(\d+)_/i);
  return match ? BLACK_OPS_2_ZOMBIES_DLC_BY_NUMBER.get(match[1]) || `DLC ${match[1]}` : '';
}

function getGraveyardKeeperDlcSource(id) {
  const normalizedId = String(id || '').toLowerCase();
  for (const [prefix, name] of GRAVEYARD_KEEPER_DLC_BY_PREFIX) {
    if (normalizedId.startsWith(prefix)) return name;
  }
  return '';
}

function getAppSpecificDlcSource(appId, id) {
  const rules = DLC_PREFIX_RULES_BY_APP.get(Number(appId)) || [];
  for (const [pattern, name] of rules) {
    if (pattern.test(id)) return name;
  }
  return '';
}

function getSafeGenericDlcSource(achievement) {
  const id = String(achievement?.id || achievement?.name || '');
  const text = `${achievement?.displayName || ''} ${achievement?.description || ''}`;

  if (/^(?:ACH_)?(?:Achievement_)?DLC0?\d+[_-]/i.test(id)) {
    const number = id.match(/DLC0?(\d+)/i)?.[1];
    return number ? `DLC ${Number(number)}` : 'DLC';
  }

  if (/^dlc[_-]/i.test(id) || /[_-]dlc0?\d+[_-]/i.test(id)) {
    return 'DLC';
  }

  if (/\bDLC\b/i.test(text) && !/\b(?:not included|excluding|except)\s+DLC\b/i.test(text)) {
    return 'DLC';
  }

  return '';
}

function getAchievementDlcSource(appId, achievement) {
  const numericAppId = Number(appId);
  const id = String(achievement?.id || achievement?.name || '');

  if (numericAppId === 2369390 && FAR_CRY_6_DLC_BY_ACHIEVEMENT.has(id)) {
    return FAR_CRY_6_DLC_BY_ACHIEVEMENT.get(id);
  }

  if (numericAppId === 8870) return getBioShockInfiniteDlcSource(id);
  if (numericAppId === 212910) return getBlackOps2ZombiesDlcSource(id);
  if (numericAppId === 599140) return getGraveyardKeeperDlcSource(id);

  return getAppSpecificDlcSource(numericAppId, id) || getSafeGenericDlcSource(achievement);
}

module.exports = { getAchievementDlcSource };
