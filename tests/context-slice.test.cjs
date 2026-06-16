'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sliceFile,
  estimateTokens,
  extractSkeleton,
  CONTEXT_SLICE_DEFAULTS,
} = require('../gsd-core/bin/lib/context-slice.cjs');

const {
  writeBelowThresholdFile,
  writeAboveThresholdFile,
  SAMPLE_SKELETON_LINES,
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

// ─── Task 2: structural skeleton extraction ───────────────────────────────────

test('extractSkeleton captures JS function, TS class + method, and Python def with correct line numbers', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const skeleton = extractSkeleton(lines);

    const findEntry = (text) => skeleton.find((e) => e.text === text);

    const jsEntry = findEntry(SAMPLE_SKELETON_LINES.jsFunction);
    const classEntry = findEntry(SAMPLE_SKELETON_LINES.tsClass);
    const methodEntry = findEntry(SAMPLE_SKELETON_LINES.tsMethod);
    const pyEntry = findEntry(SAMPLE_SKELETON_LINES.pyDef);

    assert.ok(jsEntry, 'expected JS function signature in skeleton');
    assert.ok(classEntry, 'expected TS class signature in skeleton');
    assert.ok(methodEntry, 'expected TS method signature in skeleton');
    assert.ok(pyEntry, 'expected Python def signature in skeleton');

    assert.equal(lines[jsEntry.line - 1].trim(), SAMPLE_SKELETON_LINES.jsFunction);
    assert.equal(lines[classEntry.line - 1].trim(), SAMPLE_SKELETON_LINES.tsClass);
    assert.equal(lines[methodEntry.line - 1].trim(), SAMPLE_SKELETON_LINES.tsMethod);
    assert.equal(lines[pyEntry.line - 1].trim(), SAMPLE_SKELETON_LINES.pyDef);
  } finally {
    cleanup(dir);
  }
});

test('comment-only lines never produce a skeleton entry', () => {
  const lines = [
    '// function notReal() { still just a comment }',
    '# def also_not_real(): still just a comment',
    '   * function alsoNotReal() {}',
    'function actuallyReal() {',
    '}',
  ];
  const skeleton = extractSkeleton(lines);
  const texts = skeleton.map((e) => e.text);
  assert.ok(!texts.some((t) => t.includes('notReal')));
  assert.ok(!texts.some((t) => t.includes('also_not_real')));
  assert.ok(!texts.some((t) => t.includes('alsoNotReal')));
  assert.ok(texts.some((t) => t.includes('actuallyReal')));
});

test('above-threshold file with no patterns returns skeleton-only with a note', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const result = sliceFile(filePath);
    assert.equal(result.sliced, true);
    assert.ok(Array.isArray(result.skeleton) && result.skeleton.length > 0);
    assert.deepEqual(result.windows, []);
    assert.ok(result.note && result.note.includes('skeleton only'));
  } finally {
    cleanup(dir);
  }
});
