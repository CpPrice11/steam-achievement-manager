(function exposeHistoryUndo(root) {
  function getLatestUndoableHistoryIndexes(history = []) {
    const gameIds = new Set();
    const indexes = [];

    history.forEach((entry, index) => {
      const appId = Number(entry?.game?.appId);
      if (!Number.isInteger(appId) || appId <= 0 || gameIds.has(appId)) return;
      if (!entry?.backupPath || !Array.isArray(entry.changed) || !entry.changed.length) return;
      gameIds.add(appId);
      indexes.push(index);
    });

    return indexes;
  }

  const api = { getLatestUndoableHistoryIndexes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HistoryUndo = api;
})(globalThis);
