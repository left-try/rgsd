<div align="center">

# rgsd

**Spec-driven development for AI coding agents, powered by a Recursive Language Model inference loop.**

[![npm version](https://img.shields.io/npm/v/rgsd?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/rgsd)
[![npm downloads](https://img.shields.io/npm/dm/rgsd?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/rgsd)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

</div>

---

## What is rgsd

**rgsd** is a fork of [gsd-core](https://github.com/open-gsd/gsd-core) that replaces the linear subagent model with an **RLM (Recursive Language Model) inference loop** — agents that can decompose problems by recursively calling themselves, rather than spawning one-shot leaf agents.

Where gsd-core runs planning and execution in flat, isolated subagents, rgsd treats each agent as a first-class RLM node: it can examine the context it receives, decide what sub-problems to delegate, and invoke child agents as function calls — all within a structured phase loop.

The core insight from [Recursive Language Models](https://github.com/alexzhang13/rlm): a model operating inside a code environment can call itself as a function, deferring context decomposition decisions to the model itself rather than hardcoding them in the orchestrator.

---

## How it works

Each milestone repeats the same five-step loop, one phase at a time:

1. **Discuss** — capture implementation decisions before anything is planned
2. **Plan** — research, decompose, and verify the plan fits a fresh context window
3. **Execute** — run plans in recursive waves; each executor can spawn child agents and call back into itself when context exceeds its budget
4. **Verify** — walk through what was built; diagnose and fix before declaring done
5. **Ship** — create the PR, archive the phase, repeat for the next one

The difference from gsd-core is in step 3: instead of a flat executor receiving a fixed context slice, rgsd executors operate in an RLM loop — they receive a structural skeleton of large files via the **context-slice engine**, query the **graphify knowledge graph** for relevant symbols, and recursively narrow context before generating code.

---

## Key features

### RLM inference loop
Agents call themselves recursively to decompose arbitrarily large contexts. No fixed context-window ceiling on what a single phase can reason about.

### Context-slice engine
`rgsd-tools context-slice <file>` pre-filters large source files into a structural skeleton (all function/class signatures) plus pattern-ranked excerpt windows, capped by a configurable token budget. Files below 3 000 tokens pass through unchanged. Dropped regions are reported explicitly — never silently truncated.

```bash
rgsd-tools config-set context-slice.enabled true
rgsd-tools context-slice src/graphify.cts --budget-tokens 2000
```

### Symbol-aware graphify queries
The graphify knowledge graph resolves queries through a two-tier seed matcher: exact substring matching first, fuzzy symbol-tokenized fallback second. Natural-language queries like `"find authentication middleware"` reliably expand to the right graph nodes even when no exact token matches exist.

---

## Quickstart

```bash
npx rgsd@latest
```

The installer prompts for your runtime (Claude Code, Gemini CLI, Codex, Cursor, Windsurf, and more) and whether to install globally or locally.

---

## Configuration

```bash
rgsd-tools config-set context-slice.enabled true   # enable context-slice
rgsd-tools config-set graphify.enabled true         # enable knowledge graph
```

Full configuration reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## CLI reference

```bash
rgsd-tools context-slice <file> [--pattern <regex>] [--budget-tokens N] [--context-lines N]
rgsd-tools graphify build
rgsd-tools graphify query <term>
rgsd-tools graphify status
```

Full CLI reference: [docs/CLI-TOOLS.md](docs/CLI-TOOLS.md)

---

## Relationship to gsd-core

rgsd is a fork of [gsd-core](https://github.com/open-gsd/gsd-core). It inherits the full phase-loop workflow, all commands, and the installer. The additions are:

| Feature | gsd-core | rgsd |
|---------|----------|------|
| Phase loop (discuss/plan/execute/verify/ship) | ✓ | ✓ |
| Subagent isolation | flat | recursive (RLM) |
| Context-slice engine | ✓ | ✓ (extended) |
| Graphify knowledge graph | ✓ | ✓ + fuzzy symbol matching |
| RLM inference loop in executor | — | ✓ |

---

## License

MIT — see [LICENSE](LICENSE).
