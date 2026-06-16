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

// ─── Skeleton extraction (stub — implemented in Task 2) ──────────────────────

interface SkeletonEntry {
  line: number;
  text: string;
}

/**
 * Stub for Task 2: returns an empty skeleton. Real multi-language
 * extraction is implemented in Task 2.
 */
function extractSkeleton(_lines: string[]): SkeletonEntry[] {
  return [];
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

  // Sliced branch — body extraction (skeleton/windows/droppedRegions) is
  // filled in by Tasks 2-3. Stubbed here so the gate and metadata fields
  // are present and the sliced:true branch is exercised.
  void options;
  return {
    sliced: true,
    path: filePath,
    tokenEstimate,
    lineCount,
    skeleton: extractSkeleton(lines),
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
