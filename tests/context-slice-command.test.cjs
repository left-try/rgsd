'use strict';
/**
 * context-slice-command.test.cjs — ADR-959-style capability command cutover
 * tests for `gsd-tools context-slice`, mirroring
 * tests/graphify-command-cutover.test.cjs.
 *
 * Test categories:
 *   1. UNIT (recording mock) — precise arg/call equivalence for the router
 *   2. DISPATCH — command reaches the router via default-case registry dispatch
 *   3. SUBCOMMANDS — subprocess tests with real output-shape assertions
 *   4. ERROR PATHS — unknown subcommand, usage (missing file path)
 *   5. JSON-ERRORS — structured {ok:false,reason,message} on usage/unknown errors
 *   6. REGISTRY — commandFamilies/configSchema entries
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { routeContextSliceCommand } = require('../gsd-core/bin/lib/context-slice-command-router.cjs');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const {
  writeBelowThresholdFile,
  writeAboveThresholdFile,
  enableContextSlice,
} = require('./helpers/context-slice.cjs');
const registry = require('../gsd-core/bin/lib/capability-registry.cjs');

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a recording mock for the context-slice module. sliceFileGated
 * records its call args and returns a sentinel object so tests can assert on
 * the exact 3-argument call shape without running real I/O.
 */
function makeContextSliceMock() {
  const calls = [];
  function recorder(...fnArgs) {
    const sentinel = { _mock: 'sliceFileGated', args: fnArgs };
    calls.push(sentinel);
    return sentinel;
  }
  return {
    calls,
    mock: {
      sliceFileGated: (cwd, filePath, opts) => recorder(cwd, filePath, opts),
    },
  };
}

function makeErrorRecorder() {
  const calls = [];
  const fn = (msg, reason) => calls.push({ msg, reason });
  fn.calls = calls;
  return fn;
}

// ─── 1. UNIT — precise routing equivalence via recording mock ─────────────────

describe('context-slice router: precise unit tests (recording mock)', () => {
  const CWD = '/fake/cwd';
  const RAW = false;

  test('slice <file> → calls sliceFileGated(cwd, resolvedPath, { budgetTokens: null, contextLines: null, patterns: [] })', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 0, 'error must not be called');
    assert.strictEqual(calls.length, 1, 'exactly one sliceFileGated call');
    assert.strictEqual(calls[0]._mock, 'sliceFileGated');
    assert.deepStrictEqual(calls[0].args, [
      CWD,
      path.resolve(CWD, 'foo.ts'),
      { budgetTokens: null, contextLines: null, patterns: [] },
    ]);
  });

  test('bare form `context-slice <file>` → same call shape as `context-slice slice <file>`', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'foo.ts'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 0, 'error must not be called');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args, [
      CWD,
      path.resolve(CWD, 'foo.ts'),
      { budgetTokens: null, contextLines: null, patterns: [] },
    ]);
  });

  test('--budget-tokens 500 forwards budgetTokens: 500 as a number', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--budget-tokens', '500'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 0);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].args[2].budgetTokens, 500);
    assert.strictEqual(typeof calls[0].args[2].budgetTokens, 'number',
      'budgetTokens must be a number, not a string');
  });

  test('--context-lines 10 forwards contextLines: 10 as a number', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--context-lines', '10'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 0);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].args[2].contextLines, 10);
    assert.strictEqual(typeof calls[0].args[2].contextLines, 'number');
  });

  test('WR-03: --budget-tokens -5 (negative) → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--budget-tokens', '-5'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });

  test('WR-03: --context-lines -1 (negative) → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--context-lines', '-1'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });

  test('repeated --pattern X --pattern Y forwards patterns: ["X", "Y"]', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--pattern', 'X', '--pattern', 'Y'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 0);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args[2].patterns, ['X', 'Y']);
  });

  test('WR-01: --pattern --budget-tokens 500 (flag-shaped pattern value) → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--pattern', '--budget-tokens', '500'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });

  test('WR-01: trailing --pattern with no value → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--pattern'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });

  test('malformed --budget-tokens value → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice', 'foo.ts', '--budget-tokens', 'notanumber'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });

  test('missing file path → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'slice'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.ok(
      errFn.calls[0].msg.includes('Usage: gsd-tools context-slice'),
      `usage message must match expected form; got: ${errFn.calls[0].msg}`,
    );
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });

  test('bare form with no args at all → error(usage); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.strictEqual(errFn.calls[0].reason, 'usage');
    assert.strictEqual(calls.length, 0);
  });

  test('unknown non-path subcommand "bogus" → error(sdk_unknown_command); sliceFileGated NOT called', () => {
    const { calls, mock } = makeContextSliceMock();
    const errFn = makeErrorRecorder();
    routeContextSliceCommand({
      args: ['context-slice', 'bogus'],
      cwd: CWD, raw: RAW, error: errFn, _contextSlice: mock,
    });
    assert.strictEqual(errFn.calls.length, 1, 'error must be called once');
    assert.ok(
      errFn.calls[0].msg.includes('Unknown context-slice subcommand'),
      `message must mention unknown subcommand; got: ${errFn.calls[0].msg}`,
    );
    assert.strictEqual(errFn.calls[0].reason, 'sdk_unknown_command');
    assert.strictEqual(calls.length, 0, 'sliceFileGated must NOT be called');
  });
});

// ─── helpers for subprocess-based sections ────────────────────────────────────

function runJsonErrors(args, tmpDir, env = {}) {
  const result = runGsdTools(args, tmpDir, { ...env, GSD_JSON_ERRORS: '1' });
  assert.strictEqual(result.success, false,
    `Expected failure with GSD_JSON_ERRORS=1 for args: ${args.join(' ')}\n` +
    `stdout: ${result.output}\nstderr: ${result.error}`);
  let parsed;
  try {
    parsed = JSON.parse(result.error);
  } catch (e) {
    throw new Error(
      `GSD_JSON_ERRORS=1 must emit valid JSON on stderr.\n` +
      `Args: ${args.join(' ')}\nstderr: ${result.error}\nparse error: ${e.message}`,
    );
  }
  return parsed;
}

function assertTypedError(parsed, expectedReason, label) {
  assert.strictEqual(parsed.ok, false, `${label}: error object must have ok: false`);
  assert.strictEqual(parsed.reason, expectedReason,
    `${label}: reason must be "${expectedReason}", got: ${parsed.reason}`);
  assert.ok(typeof parsed.message === 'string' && parsed.message.length > 0,
    `${label}: message must be a non-empty string`);
}

// ─── 2. DISPATCH — command reaches router via default-case ───────────────────

describe('context-slice cutover: dispatch path (default-case → capability registry)', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('context-slice slice <file> dispatches via capability registry (not hardcoded case)', () => {
    const belowFile = writeBelowThresholdFile(tmpDir);
    // With context-slice disabled the router returns a disabledResponse; the
    // key assertion here is that the command REACHES the router at all (no
    // "Unknown command: context-slice" error) — proving default→registry dispatch.
    const result = runGsdTools(['context-slice', 'slice', belowFile], tmpDir);
    assert.ok(result.success, `Expected success (disabled response), got error: ${result.error}`);
    const isUnknownCommand = (result.error || '').includes('Unknown command: context-slice');
    assert.strictEqual(isUnknownCommand, false, 'Must not emit "Unknown command: context-slice"');
  });

  test('unknown subcommand emits sdk_unknown_command (proves router reached)', () => {
    const parsed = runJsonErrors(['context-slice', 'bogus-xyzzy'], tmpDir);
    assertTypedError(parsed, 'sdk_unknown_command', 'unknown-subcommand dispatch proof');
  });
});

// ─── 3. SUBCOMMANDS / GATE — subprocess tests with real output-shape assertions ─

describe('context-slice cutover: gate + subcommand behavior', () => {
  let tmpDir;
  let planningDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    planningDir = path.join(tmpDir, '.planning');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('disabled (default) → disabled:true and file is NOT read', () => {
    const belowFile = writeBelowThresholdFile(tmpDir);
    const result = runGsdTools(['context-slice', 'slice', belowFile], tmpDir);
    assert.ok(result.success, `Expected success; error: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.disabled, true, 'disabled context-slice: disabled must be true');
    assert.strictEqual(parsed.sliced, undefined, 'disabled response must not have slice fields');
    assert.strictEqual(parsed.content, undefined, 'disabled response must not have content field');
  });

  test('enabled + below-threshold file → sliced:false with full content', () => {
    enableContextSlice(planningDir);
    const belowFile = writeBelowThresholdFile(tmpDir);
    const result = runGsdTools(['context-slice', 'slice', belowFile], tmpDir);
    assert.ok(result.success, `Expected success; error: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.sliced, false, 'below-threshold file: sliced must be false');
    assert.strictEqual(parsed.content, fs.readFileSync(belowFile, 'utf8'),
      'below-threshold file: content must equal the full file text');
  });

  test('enabled + above-threshold file → sliced:true with non-empty skeleton', () => {
    enableContextSlice(planningDir);
    const aboveFile = writeAboveThresholdFile(tmpDir);
    const result = runGsdTools(['context-slice', 'slice', aboveFile], tmpDir);
    assert.ok(result.success, `Expected success; error: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.sliced, true, 'above-threshold file: sliced must be true');
    assert.ok(Array.isArray(parsed.skeleton) && parsed.skeleton.length > 0,
      'above-threshold file: skeleton must be a non-empty array');
  });

  test('enabled + above-threshold + --pattern → non-empty windows', () => {
    enableContextSlice(planningDir);
    const aboveFile = writeAboveThresholdFile(tmpDir);
    const result = runGsdTools(['context-slice', 'slice', aboveFile, '--pattern', 'PATTERN_MARKER'], tmpDir);
    assert.ok(result.success, `Expected success; error: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.sliced, true);
    assert.ok(Array.isArray(parsed.windows) && parsed.windows.length > 0,
      'with --pattern: windows must be a non-empty array');
  });

  test('enabled + above-threshold + --pattern + tiny --budget-tokens → non-empty droppedRegions', () => {
    enableContextSlice(planningDir);
    const aboveFile = writeAboveThresholdFile(tmpDir);
    const result = runGsdTools(
      ['context-slice', 'slice', aboveFile, '--pattern', 'PATTERN_MARKER', '--budget-tokens', '50'],
      tmpDir,
    );
    assert.ok(result.success, `Expected success; error: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.sliced, true);
    assert.ok(Array.isArray(parsed.droppedRegions) && parsed.droppedRegions.length > 0,
      'tiny budget: droppedRegions must be a non-empty array');
    assert.ok(parsed.droppedLinesEstimate > 0,
      'tiny budget: droppedLinesEstimate must be positive');
  });

  test('bare form `context-slice <file>` (enabled) behaves identically to `context-slice slice <file>`', () => {
    enableContextSlice(planningDir);
    const belowFile = writeBelowThresholdFile(tmpDir);
    const result = runGsdTools(['context-slice', belowFile], tmpDir);
    assert.ok(result.success, `Expected success; error: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.sliced, false);
    assert.strictEqual(parsed.content, fs.readFileSync(belowFile, 'utf8'));
  });
});

// ─── 4. ERROR PATHS ──────────────────────────────────────────────────────────

describe('context-slice cutover: error path equivalence', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('unknown subcommand → non-zero exit', () => {
    const result = runGsdTools(['context-slice', 'bogus-sub-xyzzy'], tmpDir);
    assert.strictEqual(result.success, false, 'unknown subcommand must fail');
  });

  test('unknown subcommand error message mentions "slice"', () => {
    const result = runGsdTools(['context-slice', 'bogus-sub-xyzzy'], tmpDir);
    assert.ok(
      result.error.includes('slice'),
      `unknown-subcommand error should mention slice; got: ${result.error}`,
    );
  });

  test('missing file path → non-zero exit with usage error', () => {
    const result = runGsdTools(['context-slice', 'slice'], tmpDir);
    assert.strictEqual(result.success, false, 'missing file path must fail');
  });

  test('missing file path → error message contains usage hint', () => {
    const result = runGsdTools(['context-slice', 'slice'], tmpDir);
    assert.ok(
      result.error.includes('Usage') || result.error.includes('context-slice'),
      `missing-path error should mention usage; got: ${result.error}`,
    );
  });
});

// ─── 5. JSON-ERRORS ──────────────────────────────────────────────────────────

describe('context-slice cutover: --json-errors structured output', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('unknown subcommand → sdk_unknown_command reason', () => {
    const parsed = runJsonErrors(['context-slice', 'bogus-xyzzy'], tmpDir);
    assertTypedError(parsed, 'sdk_unknown_command', 'unknown context-slice subcommand');
  });

  test('missing file path → usage reason', () => {
    const parsed = runJsonErrors(['context-slice', 'slice'], tmpDir);
    assertTypedError(parsed, 'usage', 'context-slice slice missing file path');
  });

  test('unknown subcommand message text preserved', () => {
    const parsed = runJsonErrors(['context-slice', 'bogus-xyzzy'], tmpDir);
    assert.ok(
      parsed.message.includes('Unknown context-slice subcommand'),
      `message must start with "Unknown context-slice subcommand"; got: ${parsed.message}`,
    );
  });

  test('missing file path message text preserved', () => {
    const parsed = runJsonErrors(['context-slice', 'slice'], tmpDir);
    assert.ok(
      parsed.message.includes('context-slice'),
      `message must include "context-slice"; got: ${parsed.message}`,
    );
  });
});

// ─── 6. REGISTRY ─────────────────────────────────────────────────────────────

describe('context-slice cutover: registry entries correct', () => {
  test('commandFamilies["context-slice"] entry present and well-shaped', () => {
    const entry = registry.commandFamilies['context-slice'];
    assert.ok(entry, 'commandFamilies["context-slice"] must be present');
    assert.strictEqual(entry.capId, 'context-slice', 'commandFamilies["context-slice"].capId must be "context-slice"');
    assert.strictEqual(entry.module, 'context-slice-command-router.cjs',
      'commandFamilies["context-slice"].module must be "context-slice-command-router.cjs"');
    assert.strictEqual(entry.router, 'routeContextSliceCommand',
      'commandFamilies["context-slice"].router must be "routeContextSliceCommand"');
  });

  test('configSchema["context-slice.enabled"] entry present', () => {
    const entry = registry.configSchema['context-slice.enabled'];
    assert.ok(entry, 'configSchema["context-slice.enabled"] must be present');
    assert.strictEqual(entry.owner, 'context-slice', 'configSchema owner must be "context-slice"');
    assert.strictEqual(entry.type, 'boolean', 'configSchema type must be "boolean"');
    assert.strictEqual(entry.default, false, 'configSchema default must be false');
  });

  test('context-slice capability id in capabilities map', () => {
    const cap = registry.capabilities['context-slice'];
    assert.ok(cap, 'capabilities["context-slice"] must be present');
    assert.strictEqual(cap.role, 'feature', 'context-slice capability must have role: feature');
    assert.strictEqual(cap.tier, 'full', 'context-slice capability must have tier: full');
  });

  test('context-slice capability commands[0] entry', () => {
    const cap = registry.capabilities['context-slice'];
    assert.ok(Array.isArray(cap.commands) && cap.commands.length > 0,
      'context-slice capability must have commands array');
    const cmd = cap.commands[0];
    assert.strictEqual(cmd.family, 'context-slice');
    assert.strictEqual(cmd.module, 'context-slice-command-router.cjs');
    assert.strictEqual(cmd.router, 'routeContextSliceCommand');
  });
});
