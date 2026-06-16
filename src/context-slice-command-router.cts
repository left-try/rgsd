'use strict';
/**
 * Context-slice command router — CLI subcommand dispatcher for
 * `gsd-tools context-slice`.
 *
 * Mirrors src/graphify-command-router.cts (ADR-959 pilot) exactly: router
 * signature { args, cwd, raw, error }, the `_<module>` test-seam convention,
 * and io.cjs's output()/ERROR_REASON primitives. The router ALWAYS dispatches
 * through the gated engine entry (`sliceFileGated`) — never `sliceFile`
 * directly — so the disabled-capability gate (added inside sliceFileGated)
 * is enforced no matter how the command is invoked.
 *
 * Arg indexing:
 *   args[0] = 'context-slice'  (family — matched by dispatchCapabilityCommand)
 *   args[1] = subcommand ('slice') OR a bare file path (when args[1] does not
 *             start with '--' and is not a recognized subcommand)
 *   args[2] = file path (when args[1] === 'slice')
 *   args.indexOf('--budget-tokens') + 1 = budget-tokens value
 *   args.indexOf('--context-lines') + 1 = context-lines value
 *   every '--pattern' occurrence + 1 = one pattern value (repeatable flag)
 *
 * Test seam: pass `_contextSlice` in the options object to inject a recording
 * mock instead of the real context-slice module. The `_`-prefix follows the
 * repo's established seam convention (see other routers). Production callers
 * omit it.
 */

import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import contextSlice = require('./context-slice.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import io = require('./io.cjs');

const { output, ERROR_REASON } = io;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContextSliceModule {
  sliceFileGated(
    cwd: string,
    filePath: string,
    opts: { budgetTokens: number | null; contextLines: number | null; patterns: string[] },
  ): unknown;
}

interface RouteContextSliceCommandOptions {
  args: string[];
  cwd: string;
  raw: boolean;
  error: (message: string, reason?: string) => void;
  /** Test seam: inject a mock context-slice module. Defaults to the real module. */
  _contextSlice?: ContextSliceModule;
}

const USAGE =
  'Usage: gsd-tools context-slice <file> [--pattern <regex>]... [--budget-tokens <N>] [--context-lines <N>]';

const KNOWN_SUBCOMMANDS = new Set(['slice']);

/**
 * Heuristic distinguishing a bare file-path argument from an unrecognized
 * subcommand word: file paths contain a path separator or a '.' (extension),
 * e.g. 'foo.ts', './foo', 'dir/foo.js'. A bare word with neither (e.g.
 * 'bogus') is treated as an unknown subcommand, not a path.
 */
function looksLikePath(token: string): boolean {
  return token.includes('.') || token.includes('/') || token.includes('\\');
}

// ─── Implementation ───────────────────────────────────────────────────────────

function routeContextSliceCommand({ args, cwd, raw, error, _contextSlice }: RouteContextSliceCommandOptions): void {
  const cs: ContextSliceModule = _contextSlice ?? contextSlice;

  const subcommandOrPath = args[1];

  let filePath: string | undefined;

  if (subcommandOrPath === 'slice') {
    filePath = args[2];
  } else if (subcommandOrPath !== undefined && subcommandOrPath.startsWith('--')) {
    // e.g. `context-slice --pattern foo` with no file path at all.
    filePath = undefined;
  } else if (
    subcommandOrPath !== undefined &&
    !KNOWN_SUBCOMMANDS.has(subcommandOrPath) &&
    looksLikePath(subcommandOrPath)
  ) {
    // Bare form: `gsd-tools context-slice <file>` — args[1] is the path.
    filePath = subcommandOrPath;
  } else if (subcommandOrPath === undefined) {
    filePath = undefined;
  } else {
    error('Unknown context-slice subcommand. Available: slice', ERROR_REASON.SDK_UNKNOWN_COMMAND);
    return;
  }

  if (!filePath) {
    error(USAGE, ERROR_REASON.USAGE);
    return;
  }

  const budgetTokensIdx = args.indexOf('--budget-tokens');
  let budgetTokens: number | null = null;
  if (budgetTokensIdx !== -1) {
    const rawBudgetTokens = args[budgetTokensIdx + 1];
    const parsed = rawBudgetTokens === undefined ? NaN : parseInt(rawBudgetTokens, 10);
    // Reject negative values too (WR-03) — a negative budget behaves like
    // budget 0 (everything dropped) inside the engine rather than crashing,
    // so it must be rejected here as a usage error rather than silently
    // accepted, same as the existing NaN guard for non-numeric input.
    if (Number.isNaN(parsed) || parsed < 0) {
      error(USAGE, ERROR_REASON.USAGE);
      return;
    }
    budgetTokens = parsed;
  }

  const contextLinesIdx = args.indexOf('--context-lines');
  let contextLines: number | null = null;
  if (contextLinesIdx !== -1) {
    const rawContextLines = args[contextLinesIdx + 1];
    const parsed = rawContextLines === undefined ? NaN : parseInt(rawContextLines, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      error(USAGE, ERROR_REASON.USAGE);
      return;
    }
    contextLines = parsed;
  }

  const patterns: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pattern') {
      const value = args[i + 1];
      // A missing or flag-shaped value (e.g. `--pattern --budget-tokens`)
      // means the caller omitted the pattern by mistake — reject with a
      // usage error instead of silently treating the next flag's name as
      // a literal pattern (WR-01).
      if (value === undefined || value.startsWith('--')) {
        error(USAGE, ERROR_REASON.USAGE);
        return;
      }
      patterns.push(value);
    }
  }

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

  output(cs.sliceFileGated(cwd, resolvedPath, { budgetTokens, contextLines, patterns }), raw);
}

export = {
  routeContextSliceCommand,
};
