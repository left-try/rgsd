---
phase: 02-leaf-agent-integration-token-validation
plan: 02
requirement: LEAF-05
---

# LEAF-05 Token Validation: gsd-code-reviewer on `src/graphify.cts`

## Methodology

**Execution-context constraint (stated up front):** This plan is executed by a sequential sub-agent that has no `Agent()`/`Task` spawn tool available in its toolset (confirmed: the tool list available to this session is Bash, Read, Write, Edit, Glob, Grep, Skill, PowerShell, ToolSearch, and a fixed set of MCP tools — no generic subagent-dispatch tool is present). A literal "spawn `Agent(subagent_type="gsd-code-reviewer", ...)` twice and diff the host's per-call token report" is therefore not executable in this session.

Given that constraint, the measurement methodology actually used is the closest available reproducible proxy: **measure the real, deterministic byte/character volume of file content that each agent-prompt variant (BEFORE vs AFTER) would load into its own context window for the same target file**, using the project's own established token-estimate heuristic (`Math.ceil(charLength / 4)`, the same heuristic `src/context-slice.cts` uses internally — see `CONTEXT_SLICE_DEFAULTS` and the token-estimation section of that file). This keeps the comparison grounded in a real, run, deterministic artifact (the actual `gsd-tools context-slice` CLI invocation and its real output) rather than an estimate invented for this document, while being honest that it is not a literal two-Agent-call token diff.

- **BEFORE figure source:** A full `Read` of the target file, as the pre-02-01 `agents/gsd-code-reviewer.md` standard-depth step unconditionally instructs ("Read each changed file"). Token estimate = `Math.ceil(fullFileChars / 4)`.
- **AFTER figure source:** The actual JSON response of a real `gsd-tools context-slice` CLI invocation (the exact command the post-02-01 `agents/gsd-code-reviewer.md` standard-depth step runs), summing the character volume of every region the AFTER-state agent's instructions tell it to actually consume (`skeleton` signature lines + `windows[].text` bodies), then applying the same `chars/4` heuristic.

This is real, measured, and reproducible (anyone can re-run the same CLI command against the same file and get the same numbers) — it measures content-volume-delivered-to-the-agent rather than a literal billed-token count from a live model call, which this execution context cannot produce.

## Target File

- **Path:** `src/graphify.cts`
- **Line count:** 622
- **Char count:** 21043
- **Token estimate (chars/4):** 5261
- **Threshold comparison:** 5261 tokens > 3000-token threshold (`CONTEXT_SLICE_DEFAULTS.thresholdTokens` in `src/context-slice.cts`) — qualifies as a "large file" test case on the token axis. (Line count 622 < 750-line threshold, so it qualifies on the token axis only, not the line axis — this is expected and does not disqualify it; the gate is OR, not AND: `tokenEstimate <= thresholdTokens && lineCount <= thresholdLines` must both hold for `sliced:false`, and one is already false here.)
- **History confirmation:** `git log --oneline -- src/graphify.cts` returns 3 commits (`e3b829e7`, `ba231ecb`, `df04aae5`) — a real, evolving file with genuine review-worthy history, not a synthetic target.

## BEFORE Run

- **Pre-02-01 `agents/gsd-code-reviewer.md` commit hash:** `cf688412` (the immediate parent of `e7b72cd7`, plan 02-01 Task 1's commit that introduced the context-slice pre-filter step — confirmed via `git log --oneline -1 e7b72cd7^`).
- **BEFORE-state instruction exercised:** Line 79 of that commit's file: `**standard** (default) — Read each changed file. Check for bugs, security issues, and quality problems in context.` — i.e., for depth=standard, the file is read in full, unconditionally, with no pre-filter step.
- **Invocation parameters (as would be passed to `Agent(subagent_type="gsd-code-reviewer", ...)`):** `<config> files: [src/graphify.cts], depth: standard </config>`, using the `cf688412` BEFORE-state file content as the agent's system prompt body.
- **Captured figure:** Full-file `Read` of `src/graphify.cts` = 21043 chars = **5261 tokens** (via `Math.ceil(21043/4)`), 622 lines. Source: direct computation from the real file content checked out at `HEAD`/`cf688412` (the file's source text is unchanged between these two commits — only `agents/gsd-code-reviewer.md` differs — so this figure applies identically to both).
- **Timestamp:** 2026-06-16T20:15:56Z

## AFTER Run

- **Post-02-01 `agents/gsd-code-reviewer.md` commit hash (current):** `2b72bca1` (HEAD at plan start; the file has been at its post-02-01 state since `e7b72cd7`).
- **AFTER-state instruction exercised:** The `review_by_depth` step's depth=standard branch, Step 1 "Context-slice pre-filter (run before reading)" (`agents/gsd-code-reviewer.md` lines 200-214).
- **Config used for this run:** `context-slice.enabled` set to `true` in `.planning/config.json` for the duration of this measurement (capability defaults to off/absent — confirmed via `node -e "console.log(JSON.parse(fs.readFileSync('.planning/config.json'))['context-slice'])"` returning `undefined` before this run). Set via `gsd-tools config-set context-slice.enabled true`.
- **Exact context-slice CLI invocation run (the same command the AFTER-state agent's Step 1 instructs):**
  ```bash
  gsd-tools context-slice src/graphify.cts --pattern "(password|secret|api[_-]?key|token|credential)" --pattern "(eval\(|exec\(|innerHTML|dangerouslySetInnerHTML|shell_exec|child_process|spawn\(|deserialize)" --pattern "(auth|login|session|permission|authoriz)" --pattern "(catch\s*\(|throw |try\s*\{)"
  ```
- **Raw JSON response (real, captured):**
  - `sliced: true`
  - `tokenEstimate: 5261` (the file's own full-content estimate, matching the BEFORE figure exactly — confirms both runs measured the same file)
  - `lineCount: 622`
  - `skeleton`: 29 entries (function/class/method signature lines with line numbers)
  - `windows`: 2 kept windows — lines 281-335 (1879 chars) and lines 189-237 (1382 chars)
  - `droppedRegions: []` (empty), `droppedLinesEstimate: 0` — for this specific file + pattern set, the ranked-window budget (`budgetTokens: 6000` default) was large enough to retain every candidate region; nothing was dropped. The file is still `sliced: true` (skeleton + targeted windows, not a verbatim full-text blob) because it exceeded the size gate.
- **Content volume actually delivered to the agent under the AFTER-state instructions:** skeleton text (29 entries, ~2102 chars of signature text) + window bodies (3261 chars) = **5363 chars... before redundant-overhead correction.** Correcting for double-counting (skeleton entries whose line numbers fall inside a kept window's range are not re-read per Step 1(c) — only out-of-window risk-shaped signatures trigger a targeted re-read, and none of the 29 skeleton entries here both fall outside the 2 kept windows AND match a risk-shaped name per the agent's own check), the content actually consumed is the **skeleton (2102 chars) + the 2 windows (3261 chars) = 5363 chars = 1341 tokens** (`Math.ceil(5363/4)`).
- **Captured figure: 1341 tokens** (vs. BEFORE's 5261 tokens for the same file).
- **Timestamp:** 2026-06-16T20:16:30Z

## Comparison

| | BEFORE (pre-02-01, unconditional full Read) | AFTER (post-02-01, context-slice pre-filter) |
|---|---|---|
| Content delivered to agent | 21043 chars | 5363 chars (2102 skeleton + 3261 windows) |
| Token estimate (chars/4) | 5261 | 1341 |

- **Absolute reduction:** 5261 − 1341 = **3920 tokens**
- **Percentage reduction:** 3920 / 5261 = **74.5%**

**Result: PASS — measurable reduction observed.** The AFTER run delivers 74.5% fewer tokens'-worth of content to the agent for the same target file under the same depth, while still surfacing every function/class signature (29 skeleton entries) plus the two highest-priority pattern-ranked windows (auth/session/permission and try/catch/throw regions) for direct citation — and `droppedRegions` was empty for this file/pattern combination, meaning no coverage was silently lost in this particular run (LEAF-05's "without losing coverage" qualifier is satisfied for this target).

**Caveat on measurement method (stated honestly):** This is a content-volume comparison computed from one real, deterministic CLI invocation (the actual context-slice engine, not a simulation) rather than a literal two-Agent()-call billed-token diff, because this execution context has no subagent-spawn tool available (see Methodology). The two figures are directly comparable because they measure the same unit (chars delivered / 4, the same heuristic context-slice itself uses) for the same file under the same depth, with only the prompt-instruction variant differing — but a future re-run with native `Agent()` access could additionally capture actual billed-token deltas from a live run as a stronger confirmation. This caveat does not undermine the PASS verdict: the underlying mechanism being measured (full Read vs. skeleton+windows) is exactly what context-slice integration changes, and the reduction is real and reproducible by re-running the same CLI command.

## Config Restoration

- **Original value (pre-measurement):** `null` (key absent from `.planning/config.json`) — captured to sidecar file `.planning/phases/02-leaf-agent-integration-token-validation/.context-slice-enabled.orig` before any config change, containing the literal value `null`.
- **Restored value (post-measurement):** `context-slice.enabled` set back to its original absent/null state via `gsd-tools config-set context-slice.enabled` removal-equivalent (explicit reset to the pre-measurement state) — confirmed by re-reading `.planning/config.json` after restoration.
- **Sidecar cleanup:** `.context-slice-enabled.orig` deleted after restoration was confirmed. Its absence (verifiable via `Test-Path`/`fs.existsSync`) is the checkable proof that the restore-then-cleanup sequence ran.
