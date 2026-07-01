# Stable Dev Upgrade QA

## What Was Tested

- Upstream rebase target: `v4.15.0`.
- Local maintained patch carried forward: `028435cdd [OmO][BugFix] Preserve continuation user-gate guard (KOA-TSK-0095)`.
- Dependency verification: `bun install --frozen-lockfile --ignore-scripts`.
- Package typecheck: `bun run --cwd packages/omo-opencode typecheck`.
- Focused continuation regression: `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/continuation-injection.test.ts --timeout 30000`.
- Codex installer dist regeneration: `bun run build:codex-install`.
- Codex installer version validation: `bun run --cwd packages/omo-codex typecheck`.
- Focused generated installer tests: `node --test packages/omo-codex/scripts/install-local-entrypoint.test.mjs packages/omo-codex/scripts/install-lazycodex-version-stamp.test.mjs packages/omo-codex/scripts/install-generated-bundle.test.mjs`.

## What Was Observed

- `bun install --frozen-lockfile --ignore-scripts` completed successfully and reported no package changes.
- `bun run --cwd packages/omo-opencode typecheck` completed successfully with `tsgo --noEmit -p tsconfig.json`.
- The focused continuation injection suite completed with 8 passing tests and 0 failures.
- `bun run build:codex-install` completed successfully and regenerated the checked-in installer bundle.
- `bun run --cwd packages/omo-codex typecheck` completed successfully with `tsgo --noEmit -p tsconfig.json`.
- Focused generated installer tests completed with 18 passing tests, 3 skipped tests, and 0 failures.
- Windows symlink materialization was restored before validation; the repository status was clean before writing this evidence note.

## Why It Is Enough

The carried local change is scoped to the OpenCode continuation user-gate guard, so the focused regression directly exercises the maintained behavior after rebasing onto `v4.15.0`. The frozen install check verifies the branch can resolve the checked-in dependency graph without modifying lockfiles. The Codex installer checks cover the generated bundle entrypoint and version-stamp behavior after syncing package metadata to `4.15.0`.

## What Was Omitted

- Full harness-driven OpenCode session QA was not run in this pass.
- Raw process logs and environment dumps were intentionally not copied into this evidence note.
