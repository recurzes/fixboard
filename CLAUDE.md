# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Masterplan Location

**The masterplan lives in `notes/`. Read it before planning or building.**

- Before starting a task, check `notes/` for the masterplan, milestones, and feature list.
- Treat the specs in `notes/` as the source of truth for what is "in scope".
- If a request conflicts with the masterplan, say so before implementing.
- Don't move or rename files in `notes/` unless asked.

## 6. Log Unspecced Additions

**Anything built that isn't in the milestones or feature list gets logged.**

Keep a running log at `notes/unspecced-additions.md`. Create it if it doesn't exist. Update it - never overwrite or delete past entries.

### When to log

Add an entry whenever you add or change something that is **not** listed in the milestones or feature list in the specs. This includes:
- Features added mid-task or requested in chat
- Helpers, endpoints, screens, or config added as a prerequisite for a spec'd feature
- Behavior changes that differ from what the spec describes

Don't log: bug fixes, refactors, or tests for features that are already in the specs.

This does **not** override Section 2. Don't build unspecced things on your own - log them when they're requested or truly required.

### How to log

1. Make the code change and commit it first.
2. Gather real values - don't guess:
   - Timestamp: `date -Iseconds`
   - Commit hash: `git rev-parse --short HEAD`
   - Branch: `git branch --show-current`
3. Add the entry to the **top** of the log (newest first).
4. Commit the log update separately: `docs: log unspecced addition - <short name>`.

### Entry template

```markdown
### <Short feature name>

- **Timestamp:** 2026-10-21T17:57:00+08:00
- **Commit:** `abc1234` (message: "feat: ...")
- **Branch:** `feature/xyz`
- **PR / Issue:** #12 (or "none")
- **Requested by:** user in chat / required by [spec'd feature] / other
- **Related milestone:** M2 (or "none")
- **Why it's not in the spec:** one or two sentences
- **What changed:**
  - `path/to/file.py` - what was added or changed
  - `path/to/other.tsx` - what was added or changed
- **DB / env / dependency changes:** migrations, new env vars, new packages (or "none")
- **Status:** active / reverted / promoted to spec
- **Notes:** anything a future reader should know
```

### Keep it scannable

- One entry per addition. Short lines, no walls of text.
- If an addition is later added to the spec, change its **Status** to `promoted to spec` - don't delete the entry.
- If it's reverted, change **Status** to `reverted` and add the reverting commit hash in **Notes**.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
