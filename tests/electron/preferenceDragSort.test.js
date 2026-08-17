'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  dropIndexFromClientY,
  reorderItemsFromClientY
} = require('../../src/electron/renderer/preferenceDragSort');

const rows = [
  { id: 'claude', top: 0, bottom: 20 },
  { id: 'codex', top: 24, bottom: 44 },
  { id: 'opencode', top: 48, bottom: 68 },
  { id: 'hermes', top: 72, bottom: 92 },
  { id: 'cursor', top: 96, bottom: 116 }
];

test('dropIndexFromClientY moves an item multiple rows upward from pointer position', () => {
  assert.equal(dropIndexFromClientY(rows, 'hermes', 8), 0);
  assert.equal(dropIndexFromClientY(rows, 'hermes', 30), 1);
});

test('dropIndexFromClientY ignores the dragged row and supports dropping at the end', () => {
  assert.equal(dropIndexFromClientY(rows, 'claude', 200), 4);
  assert.equal(dropIndexFromClientY(rows, 'unknown', 200), 5);
});

test('reorderItemsFromClientY returns the live order while dragging', () => {
  assert.deepEqual(
    reorderItemsFromClientY(['claude', 'codex', 'opencode', 'hermes', 'cursor'], rows, 'hermes', 8),
    ['hermes', 'claude', 'codex', 'opencode', 'cursor']
  );
  assert.deepEqual(
    reorderItemsFromClientY(['hermes', 'claude', 'codex', 'opencode', 'cursor'], rows, 'hermes', 200),
    ['claude', 'codex', 'opencode', 'cursor', 'hermes']
  );
});
