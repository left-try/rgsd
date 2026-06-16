'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sliceFile,
  estimateTokens,
  CONTEXT_SLICE_DEFAULTS,
} = require('../gsd-core/bin/lib/context-slice.cjs');

const {
  writeBelowThresholdFile,
  writeAboveThresholdFile,
} = require('./helpers/context-slice.cjs');
const { cleanup } = require('./helpers.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-context-slice-'));
}

// ─── Task 1: threshold gate + token estimation + full-read pass-through ──────

test('estimateTokens matches Math.ceil(length / 4)', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcdefgh'), 2);
});

test('sliceFile returns sliced:false + full content for a below-threshold file', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeBelowThresholdFile(dir);
    const expected = fs.readFileSync(filePath, 'utf8');
    const result = sliceFile(filePath);
    assert.equal(result.sliced, false);
    assert.equal(result.path, filePath);
    assert.equal(result.content, expected);
  } finally {
    cleanup(dir);
  }
});

test('sliceFile returns sliced:true and non-full content for an above-threshold file', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const fullContent = fs.readFileSync(filePath, 'utf8');
    const result = sliceFile(filePath);
    assert.equal(result.sliced, true);
    assert.notEqual(result.content, fullContent);
  } finally {
    cleanup(dir);
  }
});

test('a file at exactly the threshold boundary (3000 tokens / 750 lines) is below-threshold', () => {
  const dir = makeTempDir();
  try {
    // Build a file whose tokenEstimate is exactly 3000 and lineCount is
    // exactly 750: 750 lines, each contributing to a content length whose
    // estimateTokens() rounds to exactly 3000.
    const lineText = 'x'.repeat(15);
    const lineArr = new Array(750).fill(lineText);
    let content = lineArr.join('\n');
    // Pad/trim content length to exactly 12000 chars without changing line count.
    const targetLen = CONTEXT_SLICE_DEFAULTS.thresholdTokens * 4;
    if (content.length < targetLen) {
      content = content + 'y'.repeat(targetLen - content.length);
    } else if (content.length > targetLen) {
      content = content.slice(0, targetLen);
    }
    const filePath = path.join(dir, 'boundary.txt');
    fs.writeFileSync(filePath, content, 'utf8');

    const lineCount = content.split(/\r?\n/).length;
    const tokenEstimate = estimateTokens(content);
    assert.equal(lineCount, 750);
    assert.equal(tokenEstimate, 3000);

    const result = sliceFile(filePath);
    assert.equal(result.sliced, false);
  } finally {
    cleanup(dir);
  }
});

test('sliceFile on a missing path returns an error object and does not throw', () => {
  const missing = path.join(os.tmpdir(), 'gsd-context-slice-does-not-exist', 'nope.txt');
  let result;
  assert.doesNotThrow(() => {
    result = sliceFile(missing);
  });
  assert.equal(typeof result.error, 'string');
});
