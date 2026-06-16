/**
 * context-slice — deterministic structural pre-filter engine.
 *
 * Given a file path, decides full-read vs. structural-slice based on a
 * token/line threshold (CTXSLICE-01). Below-threshold files are returned
 * byte-identical to a plain read (CTXSLICE-02). Above-threshold files
 * will return a structural skeleton (CTXSLICE-03) plus budget-capped,
 * pattern-ranked line-windows (CTXSLICE-04) — wired in subsequent tasks.
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

// ─── sliceFile ───────────────────────────────────────────────────────────────

interface SliceOptions {
  budgetTokens?: number;
  contextLines?: number;
  patterns?: string[];
}

interface SliceResult {
  sliced: boolean;
  path: string;
  tokenEstimate: number;
  lineCount: number;
  content?: string;
  skeleton?: SkeletonEntry[];
  windows?: unknown[];
  droppedRegions?: unknown[];
  droppedLinesEstimate?: number;
  note?: string;
}

interface SliceError {
  error: string;
}

/**
 * Top-level entry point. Decides full-read vs. structural-slice based on
 * the threshold gate (CTXSLICE-01). Below-threshold files are returned in
 * full (CTXSLICE-02). Above-threshold body extraction (skeleton/windows/
 * dropped-region accounting) is wired in Tasks 2-3; here the gate and
 * result metadata fields are present and the sliced:true branch is
 * exercised with stubbed body fields.
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

  const { thresholdTokens, thresholdLines } = CONTEXT_SLICE_DEFAULTS;

  if (tokenEstimate <= thresholdTokens && lineCount <= thresholdLines) {
    return { sliced: false, path: filePath, tokenEstimate, lineCount, content };
  }

  const skeleton = extractSkeleton(lines);
  const patterns = options.patterns ?? [];

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

  // Pattern-ranked windowing + budget trim is wired in Task 3. Stubbed here
  // so the gate, skeleton, and metadata fields are present and the
  // patterns-supplied branch is exercised.
  return {
    sliced: true,
    path: filePath,
    tokenEstimate,
    lineCount,
    skeleton,
    windows: [],
    droppedRegions: [],
    droppedLinesEstimate: 0,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export = {
  sliceFile,
  estimateTokens,
  extractSkeleton,
  CONTEXT_SLICE_DEFAULTS,
};
