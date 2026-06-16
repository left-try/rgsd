---
phase: 01-context-slice-command
plan: 02
subsystem: cli
tags: [context-slice, capability-router, capability-registry, config-gate, node-test]

# Dependency graph
requires:
  - phase: 01-context-slice-command (plan 01)
    provides: "src/context-slice.cts: sliceFile engine (threshold gate, skeleton extraction, pattern-ranked windows, budget trim)"
provides:
  - "src/context-slice.cts: sliceFileGated(cwd, filePath, options) gated entry point + disabledResponse()"
  - "src/context-slice-command-router.cts: routeContextSliceCommand — CLI subcommand router for `gsd-tools context-slice`"
  - "capabilities/context-slice/capability.json: capability manifest (tier:full, activationKey:context-slice.enabled, single command family)"
  - "gsd-core/bin/lib/capability-registry.cjs: regenerated with context-slice commandFamilies/configSchema/capabilities entries"
  - "tests/context-slice-command.test.cjs: 29 cutover tests (unit/dispatch/gate/subcommand/error/json-errors/registry)"
  - "tests/helpers/context-slice.cjs: enableContextSlice(planningDir) fixture writer"
affects: [phase 2 leaf-agent integration (gsd-code-reviewer, gsd-debugger, gsd-phase-researcher)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "cwd-first gated entry point (sliceFileGated) mirroring graphify's graphifyQuery(cwd, ...) shape, so the capability gate can be added with zero call-site/router churn between Task 1 (pass-through) and Task 3 (gated)"
    - "Bare-path-vs-subcommand heuristic in the router: a token is treated as a file path if it contains '.', '/', or '\\\\'; otherwise it is an unrecognized subcommand (sdk_unknown_command) — lets `gsd-tools context-slice <file>` work without an explicit `slice` verb while still rejecting typo'd subcommands"

key-files:
  created:
    - src/context-slice-command-router.cts
    - capabilities/context-slice/capability.json
  modified:
    - src/context-slice.cts (added sliceFileGated, disabledResponse, isCapabilityActive gate)
    - gsd-core/bin/lib/capability-registry.cjs (regenerated)
    - tests/context-slice-command.test.cjs (created in Task 1, extended in Task 3)
    - tests/helpers/context-slice.cjs (added enableContextSlice)
    - .gitignore (added /gsd-core/bin/lib/context-slice-command-router.cjs)

key-decisions:
  - "sliceFileGated's signature and the router were finalized in Task 1 as a pure pass-through; Task 3 added the isCapabilityActive('context-slice', cwd) gate as the function's first statement with zero changes to the router or call sites — exactly matching the plan's stub-then-gate sequencing."
  - "Disambiguated the router's bare-path vs. unknown-subcommand parsing with a 'looks like a path' heuristic (contains '.', '/', or '\\\\') rather than a fixed subcommand allowlist, since the plan requires both `context-slice slice <file>` AND a bare `context-slice <file>` form to work, while `context-slice bogus` must still surface sdk_unknown_command."
  - "Widened SliceOptions (budgetTokens/contextLines/patterns) to accept null alongside their original optional-undefined types, since the router always passes explicit null (not undefined) for unset flags — keeps the router's call shape exact per the plan's acceptance criteria without changing sliceFile's existing ?? defaulting logic."

patterns-established:
  - "Capability-command cutover for a second command family (after graphify): manifest + router + registry regen, with the registry's profileMembership/capabilityClusters maps correctly omitting capabilities with an empty skills array (context-slice has no owned skill, so it is absent from those two maps — confirmed against the generator's documented skills-ownership scope rule, not a bug)."

requirements-completed: [CTXSLICE-06, CTXSLICE-07, CTXSLICE-01, CTXSLICE-02, CTXSLICE-03, CTXSLICE-04, CTXSLICE-05]

# Metrics
duration: 40min
completed: 2026-06-16
---

# Phase 1 Plan 2: Context-Slice Command Cutover Summary

**`gsd-tools context-slice <file>` is now a registered capability command family — config-gated (default off), dispatched through the capability registry exactly like the graphify pilot, with the plan 01-01 engine wired in behind a single gated entry point — 43/43 context-slice tests passing (29 new cutover tests + 14 pre-existing engine tests), zero regressions across the 398-test capability-registry/graphify/context-slice combined suite.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3 completed
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments
- Exposed the plan 01-01 engine as `gsd-tools context-slice` via a router (`src/context-slice-command-router.cts`) that mirrors `src/graphify-command-router.cts` exactly: subcommand `slice` plus a bare-path form, `--budget-tokens`/`--context-lines`/repeatable `--pattern` flag parsing with NaN-guards, and USAGE/SDK_UNKNOWN_COMMAND error paths — verified by a 9-case recording-mock unit suite asserting the exact 3-argument `sliceFileGated(cwd, resolvedPath, opts)` call shape.
- Registered `capabilities/context-slice/capability.json` (tier `full`, `activationKey: "context-slice.enabled"`, single command family routed to `context-slice-command-router.cjs`) and regenerated `gsd-core/bin/lib/capability-registry.cjs`; `node scripts/gen-capability-registry.cjs --check` passes (no drift), and `context-slice.enabled` is owned exclusively by the capability (absent from the central config-schema manifest).
- Added the `isCapabilityActive('context-slice', cwd)` gate as the literal first statement of `sliceFileGated` — disabled (default) returns `{ disabled: true, message }` before any `fs.readFileSync` call, with zero changes to the router or to `sliceFileGated`'s signature between Task 1 and Task 3 — then proved the full dispatch → gate → enabled-behavior → error → json-errors → registry chain end-to-end with 20 additional subprocess tests mirroring `tests/graphify-command-cutover.test.cjs`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Gated engine entry + router module + flag parsing** - `1bb81048` (feat)
2. **Task 2: Capability manifest + registry regeneration + config gate** - `2081280c` (feat)
3. **Task 3: Add the config gate inside sliceFileGated + end-to-end dispatch & behavior tests** - `930bae2c` (feat)

_Note: build (`npm run build:lib`) + `node scripts/gen-capability-registry.cjs --write`/`--check` + `node --test` were run and confirmed green before each commit._

## Files Created/Modified
- `src/context-slice-command-router.cts` - CLI subcommand router for `gsd-tools context-slice`; compiles to `gsd-core/bin/lib/context-slice-command-router.cjs`. Exports `routeContextSliceCommand({ args, cwd, raw, error, _contextSlice })`.
- `src/context-slice.cts` - Added `sliceFileGated(cwd, filePath, options)` (gated entry, isCapabilityActive-first) and `disabledResponse()`; widened `SliceOptions` to accept `null` for budgetTokens/contextLines/patterns.
- `capabilities/context-slice/capability.json` - Capability manifest: `id: "context-slice"`, `role: "feature"`, `tier: "full"`, `activationKey: "context-slice.enabled"`, one command family.
- `gsd-core/bin/lib/capability-registry.cjs` - Regenerated; adds `commandFamilies['context-slice']`, `configSchema['context-slice.enabled']`, `capabilities['context-slice']`, `configKeys['context-slice.enabled']`, `_requiresGraph['context-slice']` entries.
- `tests/context-slice-command.test.cjs` - 29 tests across 6 describe blocks: UNIT (recording mock, 9 cases), DISPATCH (2), SUBCOMMANDS/GATE (6), ERROR PATHS (4), JSON-ERRORS (4), REGISTRY (4).
- `tests/helpers/context-slice.cjs` - Added `enableContextSlice(planningDir)`, mirroring `enableGraphify`.
- `.gitignore` - Added `/gsd-core/bin/lib/context-slice-command-router.cjs` to the per-file compiled-artifact ignore list, consistent with every other `src/*.cts` module.

## Decisions Made
- Followed the plan's exact stub-then-gate task sequencing (Task 1: pure pass-through; Task 3: add the gate inside the same function signature) with zero deviation — the router was never touched in Task 3.
- Resolved an ambiguity in the plan's bare-path-vs-subcommand routing rule (the plan's prose example implied "anything not starting with `--`" is a path, but its own acceptance criteria require `context-slice bogus` to produce `sdk_unknown_command`) by adding a "looks like a path" heuristic (contains `.`, `/`, or `\`) — this satisfies both the bare-form requirement and the unknown-subcommand requirement simultaneously.
- Widened `SliceOptions` to accept `null` (not just `undefined`) for its three optional fields, since the router always passes explicit `null` placeholders for unset flags (matching the plan's required exact call-shape assertion `{ budgetTokens: null, contextLines: null, patterns: [] }`).

## Deviations from Plan

None — plan executed exactly as written. The bare-path-vs-subcommand heuristic above is an implementation detail filling in an underspecified edge case in the plan's prose, not a deviation from any stated acceptance criterion; all listed acceptance criteria (including the `bogus` → `sdk_unknown_command` case) pass.

## Issues Encountered
- Initial `tsc` build failed because `SliceOptions`'s fields were typed as `number | undefined` while the router always passes `number | null`; fixed by widening `SliceOptions` to `number | null | undefined` (and `string[] | null | undefined` for patterns) — `sliceFile`'s existing `??` defaulting logic already treats `null` and `undefined` identically, so no behavior change to plan 01-01's engine.
- A stray unrelated build-drift diff appeared in `gsd-core/bin/lib/git-base-branch.cjs` after `npm run build:lib` (a stale source-comment difference, same class of issue noted in the 01-01 summary) and was reverted via `git checkout --` before the Task 1 commit, keeping each commit scoped to context-slice work only.
- The chunked `npm test` runner reported a small number of files (`bug-570-codex-leak-scanner`, `bug-641-files-from-suite-token`, `bug-730-milestone-phase-details-scope`) as failed (`✖`) during a full-suite run; re-running each of those files in isolation with `node --test` showed all tests passing — this is pre-existing parallel-chunk flakiness unrelated to this plan's changes, not a regression. The authoritative scoped check (`tests/context-slice-command.test.cjs`, `tests/context-slice.test.cjs`, `tests/capability-registry.test.cjs`, `tests/graphify-command-cutover.test.cjs` — 398 tests) passed cleanly.

## User Setup Required

None - no external service configuration required. `context-slice.enabled` defaults to `false`; operators opt in with `gsd-tools config-set context-slice.enabled true`.

## Next Phase Readiness
- `gsd-tools context-slice <file>` (and `gsd-tools context-slice slice <file>`) is now reachable, config-gated, and behaviorally verified end-to-end — ready for Phase 2 to wire `gsd-code-reviewer`, `gsd-debugger`, and `gsd-phase-researcher` to call it as a pre-filtering step (LEAF-01..03).
- No blockers. `node scripts/gen-capability-registry.cjs --check` passes; `npm run build:lib` is green; the router imports only `node:path`, the in-repo `context-slice.cjs` engine, and `io.cjs` — zero network/subprocess calls preserved through the cutover (CTXSLICE-07).

---
*Phase: 01-context-slice-command*
*Completed: 2026-06-16*
