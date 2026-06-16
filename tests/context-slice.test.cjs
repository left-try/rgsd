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
  rankWindows,
  applyContextBudget,
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
    assert.equal(result.skeleton, undefined);
    assert.equal(result.windows, undefined);
    assert.equal(result.droppedRegions, undefined);
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
    // 749 newline-joined lines of 15 chars + 1 trailing line tuned so the
    // total length is exactly 12000 chars (12000 / 4 = 3000 tokens).
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

test('CR-01: indented control-flow blocks (if/for/while/switch/catch) are excluded from the skeleton', () => {
  const lines = [
    'class Widget {',
    '  handleRequest(req) {',
    '    if (req.ready) {',
    '      doStuff();',
    '    }',
    '    for (let i = 0; i < 10; i++) {',
    '      doStuff();',
    '    }',
    '    while (req.pending) {',
    '      doStuff();',
    '    }',
    '    switch (req.kind) {',
    '      case "a":',
    '        break;',
    '    }',
    '    try {',
    '      doStuff();',
    '    } catch (err) {',
    '      handleErr(err);',
    '    }',
    '  }',
    '}',
  ];
  const skeleton = extractSkeleton(lines);
  const texts = skeleton.map((e) => e.text);
  assert.ok(texts.some((t) => t.includes('handleRequest')), 'real method signature must still be captured');
  assert.ok(!texts.some((t) => t.startsWith('if (')), 'if (...) block must not be captured as a signature');
  assert.ok(!texts.some((t) => t.startsWith('for (')), 'for (...) block must not be captured as a signature');
  assert.ok(!texts.some((t) => t.startsWith('while (')), 'while (...) block must not be captured as a signature');
  assert.ok(!texts.some((t) => t.startsWith('switch (')), 'switch (...) block must not be captured as a signature');
  assert.ok(!texts.some((t) => t.includes('catch (err)')), 'catch (...) block must not be captured as a signature');
});

test('CR-01: a parenthesized non-arrow assignment is not misclassified as a function definition', () => {
  const lines = [
    "const rawBuilt = (typeof builtAtCommit === 'string' ? builtAtCommit : '').trim();",
    'const timeoutSec = (graphifyConfig && graphifyConfig.build_timeout) || 300;',
    'const handler = (req, res) => {',
    '  return res.end();',
    '};',
  ];
  const skeleton = extractSkeleton(lines);
  const texts = skeleton.map((e) => e.text);
  assert.ok(!texts.some((t) => t.includes('rawBuilt')), 'plain parenthesized expression must not match');
  assert.ok(!texts.some((t) => t.includes('timeoutSec')), 'plain parenthesized expression must not match');
  assert.ok(texts.some((t) => t.includes('handler')), 'genuine arrow-function assignment must still match');
});

test('WR-02: a non-*-aligned continuation line inside an open block comment is not captured as a signature', () => {
  const lines = [
    '/**',
    ' * Example usage:',
    'function exampleInComment(a, b) {',
    ' */',
    'function actuallyReal() {',
    '}',
  ];
  const skeleton = extractSkeleton(lines);
  const texts = skeleton.map((e) => e.text);
  assert.ok(!texts.some((t) => t.includes('exampleInComment')),
    'a line inside an open block comment must not be captured, even if unaligned');
  assert.ok(texts.some((t) => t.includes('actuallyReal')),
    'a real signature line after the block comment closes must still be captured');
});

test('WR-02: a single-line /* ... */ comment is still excluded', () => {
  const lines = [
    '/* function notReal() {} */',
    'function actuallyReal() {',
    '}',
  ];
  const skeleton = extractSkeleton(lines);
  const texts = skeleton.map((e) => e.text);
  assert.ok(!texts.some((t) => t.includes('notReal')));
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

// ─── Task 3: pattern-ranked windows + budget trim + dropped-region reporting ──

test('rankWindows builds windows for pattern matches, clamped within file bounds', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const windows = rankWindows(lines, ['PATTERN_MARKER'], CONTEXT_SLICE_DEFAULTS.contextLines);
    assert.ok(windows.length > 0);
    for (const w of windows) {
      assert.ok(w.startLine >= 1);
      assert.ok(w.endLine <= lines.length);
      assert.ok(w.startLine <= w.endLine);
    }
  } finally {
    cleanup(dir);
  }
});

test('a small budget forces droppedRegions to be non-empty with positive droppedLinesEstimate', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    const windows = rankWindows(lines, ['PATTERN_MARKER'], CONTEXT_SLICE_DEFAULTS.contextLines);
    const { droppedRegions, droppedLinesEstimate } = applyContextBudget(windows, 50);
    assert.ok(droppedRegions.length > 0);
    assert.ok(droppedLinesEstimate > 0);
  } finally {
    cleanup(dir);
  }
});

test('adjacent matches within contextLines merge into a single window with no duplicated lines', () => {
  const lines = [];
  for (let i = 0; i < 100; i++) lines.push(`line ${i}`);
  lines[10] = 'MARK_A';
  lines[15] = 'MARK_A';

  const windows = rankWindows(lines, ['MARK_A'], 20);
  assert.equal(windows.length, 1);

  // Verify no line number appears in two kept windows (trivially true for
  // one window, but assert generally for safety with multiple patterns).
  const seen = new Set();
  for (const w of windows) {
    for (let l = w.startLine; l <= w.endLine; l++) {
      assert.ok(!seen.has(l), `line ${l} duplicated across windows`);
      seen.add(l);
    }
  }
});

test('skeleton is present and non-empty even when budgetTokens is tiny', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const result = sliceFile(filePath, { patterns: ['PATTERN_MARKER'], budgetTokens: 1 });
    assert.ok(Array.isArray(result.skeleton) && result.skeleton.length > 0);
  } finally {
    cleanup(dir);
  }
});

test('sliceFile is deterministic for identical inputs', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const opts = { patterns: ['PATTERN_MARKER'], budgetTokens: 500, contextLines: 10 };
    const a = sliceFile(filePath, opts);
    const b = sliceFile(filePath, opts);
    assert.deepStrictEqual(a, b);
  } finally {
    cleanup(dir);
  }
});

test('default budgetTokens and contextLines are applied when options omit them', () => {
  const dir = makeTempDir();
  try {
    const filePath = writeAboveThresholdFile(dir);
    const result = sliceFile(filePath, { patterns: ['PATTERN_MARKER'] });
    assert.equal(result.sliced, true);
    assert.ok(Array.isArray(result.windows));
  } finally {
    cleanup(dir);
  }
});
