'use strict';

// Unit tests for symbol-aware fuzzy seeding utilities (Phase 3 plan 03-01).
// Refs SEED-01, SEED-03, SEED-04.

const fs = require('fs');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  tokenizeQuery,
  splitSymbolTokens,
  buildNodeSearchTokens,
  matchFuzzySeeds,
} = require('../gsd-core/bin/lib/graphify.cjs');

const { SESSION_EXPIRY_GRAPH } = require('./helpers/graphify.cjs');

describe('tokenizeQuery', () => {
  test('strips stopwords and punctuation from natural-language query', () => {
    assert.deepEqual(
      tokenizeQuery('where do we handle session expiry'),
      ['handle', 'session', 'expiry']
    );
  });
});

describe('splitSymbolTokens', () => {
  test('decomposes camelCase identifiers', () => {
    assert.deepEqual(splitSymbolTokens('evictStaleToken'), ['evict', 'stale', 'token']);
  });

  test('decomposes snake_case identifiers', () => {
    assert.deepEqual(splitSymbolTokens('session_manager'), ['session', 'manager']);
  });

  test('decomposes PascalCase identifiers', () => {
    assert.deepEqual(splitSymbolTokens('AuthService'), ['auth', 'service']);
  });
});

describe('buildNodeSearchTokens', () => {
  test('builds searchable token set from node label and description', () => {
    const node = SESSION_EXPIRY_GRAPH.nodes[0];
    const tokens = buildNodeSearchTokens(node);
    assert.ok(tokens.has('evict'));
    assert.ok(tokens.has('stale'));
    assert.ok(tokens.has('token'));
    assert.ok(tokens.has('session'));
  });
});

describe('matchFuzzySeeds', () => {
  test('finds evictStaleToken for session expiry NL query', () => {
    const results = matchFuzzySeeds(
      SESSION_EXPIRY_GRAPH,
      'where do we handle session expiry'
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'sess-1');
  });

  test('returns empty array for gibberish query', () => {
    const results = matchFuzzySeeds(
      SESSION_EXPIRY_GRAPH,
      'nonexistent gibberish xyz'
    );
    assert.deepEqual(results, []);
  });

  test('returns identical ordering on repeated calls', () => {
    const args = [SESSION_EXPIRY_GRAPH, 'where do we handle session expiry'];
    const first = matchFuzzySeeds(...args).map((n) => n.id);
    const second = matchFuzzySeeds(...args).map((n) => n.id);
    assert.deepEqual(first, second);
  });
});

describe('applyBudget static guard (SEED-03)', () => {
  const graphifySrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'graphify.cts'),
    'utf8'
  );

  test('CONFIDENCE_ORDER drop sequence unchanged in applyBudget', () => {
    assert.match(
      graphifySrc,
      /const CONFIDENCE_ORDER = \['AMBIGUOUS', 'INFERRED', 'EXTRACTED'\]/
    );
  });

  test('applyBudget does not call seeding helpers', () => {
    const fnMatch = graphifySrc.match(/function applyBudget[\s\S]*?(?=\nfunction |\n\/\/ ─)/);
    assert.ok(fnMatch, 'applyBudget function body must exist');
    const body = fnMatch[0];
    assert.ok(!body.includes('matchFuzzySeeds'), 'applyBudget must not call matchFuzzySeeds');
    assert.ok(!body.includes('findSubstringSeeds'), 'applyBudget must not call findSubstringSeeds');
  });
});

describe('seeding functions perform no filesystem writes (SEED-04)', () => {
  const graphifySrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'graphify.cts'),
    'utf8'
  );

  function extractFunctionBody(src, name) {
    const re = new RegExp(`function ${name}\\([\\s\\S]*?(?=\\nfunction |\\ninterface |\\nconst [A-Z]|\\n// ─)`);
    const match = src.match(re);
    assert.ok(match, `${name} must exist`);
    return match[0];
  }

  for (const fn of ['findSubstringSeeds', 'matchFuzzySeeds', 'seedAndExpand']) {
    test(`${fn} has no writeFileSync or writeSnapshot calls`, () => {
      const body = extractFunctionBody(graphifySrc, fn);
      assert.ok(!body.includes('writeFileSync'), `${fn} must not write files`);
      assert.ok(!body.includes('writeSnapshot'), `${fn} must not write snapshots`);
    });
  }
});
