const assert = require('node:assert/strict');
const test = require('node:test');

const { getLatestUndoableHistoryIndexes } = require('../domain/history-undo');

test('selects the latest applied operation with a backup for each game', () => {
  const history = [
    { game: { appId: 10 }, backupPath: 'failed.json', changed: [] },
    { game: { appId: 20 }, backupPath: 'game-20.json', changed: [{ id: 'B' }] },
    { game: { appId: 10 }, backupPath: 'game-10.json', changed: [{ id: 'A' }] },
    { game: { appId: 20 }, backupPath: 'older-game-20.json', changed: [{ id: 'C' }] },
    { game: { appId: 30 }, backupPath: '', changed: [{ id: 'D' }] },
  ];

  assert.deepEqual(getLatestUndoableHistoryIndexes(history), [1, 2]);
});
