/**
 * context-slice — deterministic structural pre-filter engine.
 *
 * Given a file path, decides full-read vs. structural-slice based on a
 * token/line threshold (CTXSLICE-01). Below-threshold files are returned
 * byte-identical to a plain read (CTXSLICE-02). Above-threshold files
 * return a structural skeleton of function/class/method signature lines
 * (CTXSLICE-03), plus — when the caller supplies patterns — budget-capped,
 * pattern-ranked line-windows alongside the skeleton (CTXSLICE-04). Any
 * region trimmed by the budget is explicitly named in droppedRegions with
 * a droppedLinesEstimate so coverage loss is never silent (CTXSLICE-05).
 *
 * This module performs only fs reads and pure string/regex work — zero
 * network calls, zero subprocess spawns, zero LLM calls (CTXSLICE-07).
 */

import fs from 'node:fs';

// ─── Defaults ────────────────────────────────────────────────────────────────

interface ContextSliceDefaults {
  thresholdTokens: number;
  thresholdLines: number;
  budgetTokens: number;
  contextLines: number;
}

const CONTEXT_SLICE_DEFAULTS: ContextSliceDefaults = Object.freeze({
  thresholdTokens: 3000,
  thresholdLines: 750,
  budgetTokens: 6000,
  contextLines: 20,
});

// ─── Token estimation ────────────────────────────────────────────────────────

/**
 * Estimate token count for a string. Reuses the established graphify token
 * heuristic (src/graphify.cts applyBudget, ~line 305-312): there it is
 * `Math.ceil(JSON.stringify(obj).length / 4)`; here, for raw file text, it
 * is the same `length / 4` heuristic applied directly to the text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Skeleton extraction ─────────────────────────────────────────────────────

interface SkeletonEntry {
  line: number;
  text: string;
}

const SKELETON_PATTERNS: RegExp[] = [
  // JS/TS function declarations (export/default/async modifiers optional)
  /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+\w+/,
  // Arrow-function assignments: const/let/var foo = (async) (
  /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
  // Class declarations
  /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+\w+/,
  // TS interface / type alias
  /^\s*(export\s+)?(interface|type)\s+\w+/,
  // Class methods (indented inside a class body)
  /^\s{2,}(public\s+|private\s+|protected\s+|static\s+|async\s+)*\w+\s*\([^)]*\)\s*[:{]/,
  // Python async def / def
  /^\s*(async\s+)?def\s+\w+/,
  // Python class
  /^\s*class\s+\w+/,
];

/**
 * Lines that are pure comment prose must never produce a false signature
 * match (the negative-guard idiom: a region-scoped grep gate must not
 * self-invalidate on comment text describing the thing it's guarding).
 */
function isCommentOnlyLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

/**
 * Extract structural signature lines (function/class/method/interface/type
 * declarations) from a file's lines. Regex-based, multi-language
 * (JS/TS + Python) best-effort matching. Returns 1-based line numbers.
 */
function extractSkeleton(lines: string[]): SkeletonEntry[] {
  const results: SkeletonEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (isCommentOnlyLine(trimmed)) continue;
    if (SKELETON_PATTERNS.some((re) => re.test(raw))) {
      results.push({ line: i + 1, text: trimmed });
    }
  }
  return results;
}

// ─── Pattern-ranked windows ──────────────────────────────────────────────────

interface RankedWindow {
  startLine: number;
  endLine: number;
  matchCount: number;
  text: string;
}

interface DroppedRegion {
  startLine: number;
  endLine: number;
  matchCount: number;
}

/**
 * Find every line matching any of `patterns` (case-insensitive regex),
 * build a context window of [matchLine - contextLines, matchLine +
 * contextLines] (1-based, clamped to file bounds) per match, then merge
 * overlapping/adjacent windows so no line is duplicated across windows.
 * Windows are ranked by distinct-match count descending, ties broken by
 * earliest start line (deterministic, stable order).
 */
function rankWindows(lines: string[], patterns: string[], contextLines: number): RankedWindow[] {
  const compiled: RegExp[] = [];
  for (const p of patterns || []) {
    try {
      compiled.push(new RegExp(p, 'i'));
    } catch {
      // Malformed pattern — skip it, never fatal (T-01-02).
    }
  }

  if (compiled.length === 0) return [];

  const matchLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (compiled.some((re) => re.test(lines[i]))) {
      matchLines.push(lineNo);
    }
  }

  if (matchLines.length === 0) return [];

  // Build raw [start, end] windows per match, clamped to file bounds.
  const raw = matchLines
    .map((m) => ({
      start: Math.max(1, m - contextLines),
      end: Math.min(lines.length, m + contextLines),
      matches: [m],
    }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping/touching windows.
  const merged: { start: number; end: number; matches: number[] }[] = [];
  for (const win of raw) {
    const last = merged[merged.length - 1];
    if (last && win.start <= last.end + 1) {
      last.end = Math.max(last.end, win.end);
      last.matches.push(...win.matches);
    } else {
      merged.push({ start: win.start, end: win.end, matches: [...win.matches] });
    }
  }

  const ranked: RankedWindow[] = merged.map((m) => {
    const distinctMatches = new Set(m.matches).size;
    const text = lines.slice(m.start - 1, m.end).join('\n');
    return { startLine: m.start, endLine: m.end, matchCount: distinctMatches, text };
  });

  ranked.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return a.startLine - b.startLine;
  });

  return ranked;
}

interface BudgetResult {
  windows: RankedWindow[];
  droppedRegions: DroppedRegion[];
  droppedLinesEstimate: number;
}

/**
 * Keep highest-ranked windows whole until adding the next window would
 * exceed budgetTokens; the first window that does not fit and all
 * lower-ranked windows are dropped and reported (CTXSLICE-05). Models the
 * "estimate tokens, drop lowest-priority units, report what was omitted"
 * structure of graphify's applyBudget (src/graphify.cts, ~line 305).
 */
function applyContextBudget(windows: RankedWindow[], budgetTokens: number): BudgetResult {
  const kept: RankedWindow[] = [];
  const droppedRegions: DroppedRegion[] = [];
  let cumulativeTokens = 0;
  let droppedLinesEstimate = 0;
  let dropping = false;

  for (const win of windows) {
    if (!dropping) {
      const winTokens = estimateTokens(win.text);
      if (cumulativeTokens + winTokens <= budgetTokens) {
        cumulativeTokens += winTokens;
        kept.push(win);
        continue;
      }
      dropping = true;
    }
    droppedRegions.push({ startLine: win.startLine, endLine: win.endLine, matchCount: win.matchCount });
    droppedLinesEstimate += win.endLine - win.startLine + 1;
  }

  return { windows: kept, droppedRegions, droppedLinesEstimate };
}

// ─── sliceFile ───────────────────────────────────────────────────────────────

interface SliceOptions {
  budgetTokens?: number | null;
  contextLines?: number | null;
  patterns?: string[] | null;
}

interface SliceResult {
  sliced: boolean;
  path: string;
  tokenEstimate: number;
  lineCount: number;
  content?: string;
  skeleton?: SkeletonEntry[];
  windows?: RankedWindow[];
  droppedRegions?: DroppedRegion[];
  droppedLinesEstimate?: number;
  note?: string;
}

interface SliceError {
  error: string;
}

/**
 * Top-level entry point. Decides full-read vs. structural-slice based on
 * the threshold gate (CTXSLICE-01), and for above-threshold files returns
 * a skeleton plus budget-capped, pattern-ranked windows (CTXSLICE-03,
 * CTXSLICE-04) with every dropped region named (CTXSLICE-05).
 */
function sliceFile(filePath: string, options: SliceOptions = {}): SliceResult | SliceError {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { error: `context-slice: cannot read ${filePath}: ${reason}` };
  }

  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const tokenEstimate = estimateTokens(content);

  const { thresholdTokens, thresholdLines, budgetTokens: defaultBudget, contextLines: defaultContextLines } =
    CONTEXT_SLICE_DEFAULTS;

  if (tokenEstimate <= thresholdTokens && lineCount <= thresholdLines) {
    return { sliced: false, path: filePath, tokenEstimate, lineCount, content };
  }

  const budgetTokens = options.budgetTokens ?? defaultBudget;
  const contextLines = options.contextLines ?? defaultContextLines;
  const patterns = options.patterns ?? [];

  const skeleton = extractSkeleton(lines);

  if (patterns.length === 0) {
    return {
      sliced: true,
      path: filePath,
      tokenEstimate,
      lineCount,
      skeleton,
      windows: [],
      droppedRegions: [],
      droppedLinesEstimate: 0,
      note: 'context-slice: above threshold and no patterns supplied — returning skeleton only; pass --pattern for body content',
    };
  }

  const ranked = rankWindows(lines, patterns, contextLines);
  const { windows, droppedRegions, droppedLinesEstimate } = applyContextBudget(ranked, budgetTokens);

  return {
    sliced: true,
    path: filePath,
    tokenEstimate,
    lineCount,
    skeleton,
    windows,
    droppedRegions,
    droppedLinesEstimate,
  };
}

// ─── Gated entry point ───────────────────────────────────────────────────────

/**
 * Gated entry point for the `context-slice` CLI command (CTXSLICE-06). The
 * `cwd`-first parameter order mirrors graphify's `graphifyQuery(cwd, ...)` so
 * a config gate can be added later (see src/graphify.cts disabledResponse
 * pattern) with zero call-site churn. For now this is a pure pass-through to
 * sliceFile — the gate itself is added in a later task.
 */
function sliceFileGated(
  cwd: string,
  filePath: string,
  options: SliceOptions = {},
): SliceResult | SliceError {
  return sliceFile(filePath, options);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export = {
  sliceFile,
  sliceFileGated,
  estimateTokens,
  extractSkeleton,
  rankWindows,
  applyContextBudget,
  CONTEXT_SLICE_DEFAULTS,
};
