const { countKnownAchievementStates } = require('./achievement-state');

function getGameProvenance(schema, states, achievementIds, dlcResults = []) {
  const schemaStatus = String(schema?.status || '');
  const stateStatus = String(states?.status || '');
  const source = {
    schema: schemaStatus,
    achievementStates: Array.isArray(states?.sources) ? states.sources.map(String) : [],
    dlc: [],
  };
  const warnings = Array.isArray(states?.errors) ? states.errors.map(String) : [];
  const errors = [];

  if (schemaStatus.startsWith('unavailable')) errors.push(`schema: ${schemaStatus}`);
  if (achievementIds.length && (!states?.states || !countKnownAchievementStates(states.states))) {
    errors.push(`states: ${stateStatus || 'unavailable'}`);
  }

  for (const { appId, provenance } of dlcResults) {
    if (!provenance) continue;
    source.dlc.push({
      appId,
      schema: provenance.source.schema,
      achievementStates: provenance.source.achievementStates,
    });
    warnings.push(...provenance.warnings.map((warning) => `DLC ${appId}: ${warning}`));
    errors.push(...provenance.errors.map((error) => `DLC ${appId}: ${error}`));
  }

  return { source, warnings, errors };
}

module.exports = { getGameProvenance };
