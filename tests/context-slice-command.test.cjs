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

const { routeContextSliceCommand } = require('../gsd-core/bin/lib/context-slice-command-router.cjs');

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
