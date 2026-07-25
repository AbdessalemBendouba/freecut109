---
name: toolchain-notes
description: FreeCut's build/dep toolchain rationale. Read before upgrading any dependency, bumping TypeScript or vite-plus, changing type-checking or lint/format config, or re-baselining the fallow unused-export allowlists.
---

# Toolchain & dependency notes

The hard rules live in the root `CLAUDE.md`; this file is the rationale behind them.

## vite-plus is the whole stack

The entire dev/build/test/lint/format stack runs through **vite-plus** (`vp`, currently 0.x / pre-1.0) — it wraps Vite, Vitest, Oxlint, Oxfmt and the task runner. There is no plain-Vite fallback configured; if `vp` breaks, pin the last working version in `package.json` rather than attempting an ad-hoc migration.

`oxlint` / `oxfmt` / `@oxc-project/types` are **not** direct deps — vite-plus exact-pins them internally, so they only move when `vp` moves. A `vp` bump can therefore reformat the tree (0.2.4 brought oxfmt 0.57 and reflowed 52 files); land that churn as its own commit.

## Deliberately pinned dependencies

- `onnxruntime-web` is intentionally pinned to a **dev build** (`1.26.0-dev.*`) — introduced with the supertonic TTS integration. Moving to a stable release requires re-validating transcription, TTS and scene detection.
- `lucide-react` is held at 0.468.x deliberately (Vite pre-bundles it; see the `optimizeDeps` gotcha in the root `CLAUDE.md`). A major-version bump is a deliberate task, not a routine dep update.
- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`).

## TypeScript 7 needs the `overrides.typescript` entry

`i18next` and `react-i18next` declare `peerOptional typescript@"^5"`, so any TS >= 6 fails a clean `npm install`/`npm ci` with ERESOLVE (an *incremental* install over an existing tree misleadingly succeeds). The override in `package.json` forces one TS copy and must be bumped in lockstep with the `typescript` devDependency.

`@voidzero-dev/vite-plus-core` also peers `^5 || ^6`, but never loads the package — it shells out to the tsgolint binary — so that one is inert.

## Type checking does not run `tsc`

`vp check` type-checks via **tsgolint** (the TypeScript-Go engine), which is why CI already had native-speed checking before the TS 7 bump. Nothing in `package.json` scripts or CI invokes `tsc`; the `typescript` devDependency exists for editor tsserver and ad-hoc `npx tsc`. TS 7.0 ships no stable programmatic API — if a tool ever needs one, alias `@typescript/typescript6`.

## The fallow allowlists are baselines, not approvals

`check:unused-exports` and `check:unused-class-members` are ratchets: they fail only on findings *new* since the baseline, plus stale entries. Every entry carries a `reason`, and re-baselined ones are tagged:

- `parked-ai-feature` — the unwired assistant, see `ai-tab.tsx`
- `deps-contract` — adapter surface the boundary rules require
- `barrel-surface` — feature `index.ts` public API
- `unreviewed` — never traced; start here when cleaning up

Never bulk-`fallow fix` these — trace per export. Re-baseline by regenerating both files from `fallow dead-code --format json`, preserving existing reasons; a stale baseline makes the gate fail permanently and get ignored.
