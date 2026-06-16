'use strict';

// Shared fixtures for the context-slice engine test suite.
// Mirrors tests/helpers/graphify.cjs: module-level fixture writers +
// exported sample constants.

const fs = require('fs');
const path = require('path');

/**
 * Write a small file that is below the context-slice threshold
 * (<=3000 tokens, <=750 lines) and return its full path.
 */
function writeBelowThresholdFile(dir) {
  const filePath = path.join(dir, 'below-threshold.js');
  const content = [
    '// A small file, well under the threshold.',
    'function greet(name) {',
    '  return `hello ${name}`;',
    '}',
    '',
    'module.exports = { greet };',
    '',
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Known signature lines present in the above-threshold fixture, by 1-based
 * line number once written. Exported so tests can assert on exact text.
 */
const SAMPLE_SKELETON_LINES = {
  jsFunction: 'function jsHandlerOne(req, res) {',
  tsClass: 'export class WidgetController {',
  tsMethod: 'handleRequest(req) {',
  pyDef: 'def py_handler_one(arg):',
};

/**
 * Write a large, multi-language file that exceeds the context-slice
 * threshold (>750 lines) and contains at least one JS function
 * declaration, one TS class, one Python def, and one class method, so
 * tests can assert multi-language skeleton extraction. Returns the full
 * path.
 */
function writeAboveThresholdFile(dir) {
  const filePath = path.join(dir, 'above-threshold.txt');
  const lines = [];

  lines.push('// Synthetic multi-language fixture for context-slice tests.');
  lines.push('// PATTERN_MARKER appears multiple times below for window tests.');
  lines.push('');
  lines.push(SAMPLE_SKELETON_LINES.jsFunction);
  lines.push('  // PATTERN_MARKER: js handler body');
  lines.push('  return res.send("ok");');
  lines.push('}');
  lines.push('');
  lines.push(SAMPLE_SKELETON_LINES.tsClass);
  lines.push('  ' + SAMPLE_SKELETON_LINES.tsMethod);
  lines.push('    // PATTERN_MARKER: ts method body');
  lines.push('    return this.req;');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push(SAMPLE_SKELETON_LINES.pyDef);
  lines.push('    # PATTERN_MARKER: python handler body');
  lines.push('    return arg');
  lines.push('');

  // Pad with filler lines (plain prose + comments) until well above 750
  // lines / 3000 tokens, sprinkling a few more PATTERN_MARKER occurrences
  // and additional signature lines for multi-language coverage.
  let i = 0;
  while (lines.length < 900) {
    lines.push(`// filler comment line ${i} describing nothing in particular`);
    lines.push(`const filler${i} = ${i}; // plain statement, not a signature`);
    if (i % 50 === 0) {
      lines.push(`function jsHandlerExtra${i}(req, res) {`);
      lines.push('  // PATTERN_MARKER: extra js handler body');
      lines.push('  return res.end();');
      lines.push('}');
    }
    if (i % 75 === 0) {
      lines.push(`async def py_handler_extra_${i}(arg):`);
      lines.push('    # extra python handler body');
      lines.push('    return arg');
    }
    i += 1;
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

/**
 * Enable the context-slice capability in a temp project's .planning/config.json.
 * Mirrors enableGraphify (tests/helpers/graphify.cjs).
 */
function enableContextSlice(planningDir) {
  const configPath = path.join(planningDir, 'config.json');
  const config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
    : {};
  config['context-slice'] = { enabled: true };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = {
  writeBelowThresholdFile,
  writeAboveThresholdFile,
  SAMPLE_SKELETON_LINES,
  enableContextSlice,
};
