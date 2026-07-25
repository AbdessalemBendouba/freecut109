# FreeCut Web

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

## Key Patterns

- **Timeline store split**: `useTimelineStore` (`timeline-store.ts`) is a **facade** over domain stores (items, transitions, keyframes, markers, settings, command). Components use the facade with selectors; action code reaches domain stores via `.getState()` directly
- **Timeline mutations**: never mutate timeline stores directly. Action modules in `features/timeline/stores/actions/*.ts` wrap every mutation in `execute()` from `shared.ts` for undo/redo integration
- **TimelineItem composition**: the per-clip component (`timeline-item/index.tsx`) orchestrates a set of dedicated hooks and renders the JSX; sub-components live alongside it. When adding new clip state, prefer a new hook over inlining
- **Compositions & sequences**: pre-compositions (sub-comps) are 1-level nesting only, with dedicated stores and actions in `composition-actions.ts`. Top-level sequence tabs (`sequences-store.ts`, `topLevelSequenceIds`) are the same SubComposition model surfaced as tabs — entering a tab is "first drill level from Main"
- **Runtime layer**: `src/runtime/` (composition renderer + player) turns a project into rendered frames and is shared by preview and export. It is not a feature; features consume it, never the reverse
- **Migrations**: `src/shared/projects/migrations/` — versioned migrations + normalization run on every project load. Increment `CURRENT_SCHEMA_VERSION` in `types.ts` when adding one
- **i18n**: i18next + react-i18next. Conventions and the partials layout live in `src/i18n/CLAUDE.md`
- **Media processing**: Mediabunny for decode, WebCodecs for export, Web Workers for heavy ops. ProRes comes from the `@mediabunny/prores` extension — keep its version in lockstep with `mediabunny`
- **Storage**: workspace folder via File System Access API (`infrastructure/storage/workspace-fs/`). Source of truth is a user-picked directory on disk — projects, media metadata, thumbnails, waveforms, gif frames, decoded audio and transcripts are all plain files. `WorkspaceGate` blocks app render until a workspace is granted. IndexedDB holds **only** a small handle registry (`freecut-handles-db`) for non-serializable `FileSystem*Handle` refs; legacy `video-editor-db` is read solely by the one-time migration under `legacy-idb/`. Import from the `@/infrastructure/storage` barrel

## Code Style

- `no-console` — always use `createLogger` from `src/shared/logging/logger.ts`
- **Logging**: use the wide event pattern for multi-step operations (export, import, save): `log.startEvent(name, opId)` accumulates context and emits one structured event via `.success()` / `.failure()`. Correlate with `createOperationId()`, and include business context (project ID, item counts, codec, resolution)

## Testing

- Run tests with `npx vp test run` (full suite) or `npx vp test run <file>`. Run the **full** suite before pushing — cross-file mock breakage (a stale `vi.mock` missing a newly added service method) only surfaces in a full run
- **Pure-logic tests opt out of jsdom.** `vite.config.ts` defaults to `environment: 'jsdom'`, but a test that never touches `document` / `window` / `navigator` / testing-library should start with `// @vitest-environment node` on line 1 (blank line after) — building a jsdom per file is ~30% of the suite's wall clock. Keep the jsdom default: a file wrongly marked `node` fails loudly with `document is not defined`, whereas flipping the default would silently break any file someone forgot to annotate. Leave a file on jsdom if it merely *mentions* `window`/`navigator` — a `typeof window !== 'undefined'` branch would take the non-browser path with every assertion still green
- **Only write tests that exercise real logic.** A test must be able to fail for a reason other than someone editing a constant or a string. Worth testing: algorithm/math (FPS/timeline conversions, transitions, interpolation, colour/curve math), reducer and state-machine transitions, schema migrations, edge cases, named regressions. Not worth testing: config/registry/preset constants re-asserted back to themselves, `typeof x === 'function'` or initial-state assertions on stores, mocked functions returning their mock values, a rendered component asserting a passed-in prop with no branching behind it, or library behaviour (Radix, jsdom events, controlled inputs). Where the only collaborators are mocked, test against a real in-memory fake instead. If unsure, prefer no test over a low-value one

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` hides the debug panel in dev (shown by default)

## Toolchain & dependency notes

- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`). `onnxruntime-web` (dev build) and `lucide-react` (0.468.x) are pinned **deliberately** — never routine-bump either
- **Never bulk-`fallow fix`.** The `check:unused-exports` / `check:unused-class-members` allowlists are ratchet baselines, not approvals — trace per export
- Full rationale (vite-plus, the TypeScript 7 `overrides` entry, tsgolint, re-baselining fallow, oxlint/oxfmt churn): see the `toolchain-notes` skill

## Git

- `main` — production, `staging` — pre-release integration, `develop` — active development
- Commit work straight to `develop` — do **not** cut feature branches
- PR target: `staging` (`develop` PRs into `staging`; `staging` is promoted to `main`). Do **not** open PRs against `main` directly
- Conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)

## Gotchas

Things that are wrong in a way the code doesn't reveal.

### Boundaries & tooling

- **Feature boundaries** — cross-feature imports go through `deps/` adapter modules, and the actual cross-feature import must sit in a `*-contract.ts` inside `deps/` (a plain adapter is `export * from './x-contract'`). Enforced by `check:boundaries` + `check:deps-contracts`, plus `check:legacy-lib-imports` (tripwire against reintroducing `@/lib/*`) and `check:edge-budgets`. **There is no pre-push hook** — these run only under `npm run verify` and in CI, so they pass `check`/lint locally and still fail CI. Run the scripts directly before pushing
- Feature modules use `index.ts` barrels to define public API surface
- `routeTree.gen.ts` is auto-generated — don't edit it. Run `npm run routes` after adding/changing route files
- Vite pre-bundles `lucide-react` to avoid analyzing 1500+ icons — don't remove it from `optimizeDeps`
- Build uses manual chunk splitting — check `vite.config.ts` when adding large dependencies
- `shared/logging/logger.ts` uses only `function` declarations (no `class`/`const` at module scope) to avoid temporal dead zone errors in production chunk ordering — maintain this pattern
- `*.mp4` files are gitignored

### Timeline

- **A timeline item carries two different frame domains.** Placement (`from`, `durationInFrames`) is in **project FPS**; `sourceStart`/`sourceEnd`/`sourceDuration` are in **source-native FPS**. Mixing them produces silently wrong math with no error — convert using the media's `fps` from the media library store
- Track `order`: lower value = visually higher. New tracks go at `minOrder - 1`. When creating pre-comps, place the comp item on the bottom-most (highest order) selected track; dissolve expands upward
- `_splitItem()` returns `{ leftItem, rightItem } | null` — capture the return for correct IDs; the original item ID is stale after a split
- After clip edits that change position or duration, call `applyTransitionRepairs(changedClipIds)` from `shared.ts` — transitions then auto-heal or report breakages
- **Track groups ("Layer Groups") are a Compose-workspace feature, not a main-timeline one.** The only creation site is `createGroupFromSelection` in `compose-workspace/compositing-timeline.tsx`. The main timeline only consumes them: `classic-tracks.ts` filters `isGroup` rows out, `timeline-track.tsx` reads the parent for inherited gating. 1-level by construction — a group row holds `items: []` and grouping derives from the tracks of selected *items*, so a group can never become a child. Group rows are headers: never place items on them. `locked`/`muted`/`visible`/`solo` propagate one level via `resolveEffectiveTrackStates()` (`features/timeline/utils/group-utils.ts`), which also drops container rows from the returned lanes

### Rendering

- `StableVideoSequence`'s `areGroupPropsEqual` (`src/runtime/composition-runtime/components/stable-video-sequence-comparator.ts`) whitelists item properties for `React.memo`. **When adding a visual property to `TimelineItem`, add it here** — a missing property causes stale renders during playback, with no error
- Effects and transitions are **GPU-only**, via WebGPU shaders in `infrastructure/gpu-effects/` and `infrastructure/gpu-transitions/`. Legacy CSS filter / glitch / halftone / vignette / LUT item types were removed in the v6 migration. Transition renderers additionally carry a Canvas 2D `renderCanvas()` fallback for non-WebGPU environments; its `drawImage` offsets must use `Math.round()` or you get sub-pixel interpolation artifacts
- Updating multiple GPU effect params atomically (e.g. colour wheel hue + amount) needs `onParamsBatchChange`/`onParamsBatchLiveChange` — calling `onParamChange` twice reads stale state on the second call and overwrites the first
- Effects needing LUT-like auxiliary data declare `dataTexture` on their `GpuEffectDefinition`; the pipeline binds it at `@group(0) @binding(3)` and invalidates bind groups only when dimensions change. `gpu-lut` instead embeds resampled `.cube` data in effect params, so bundles and export workers need no side channel
- **Implicit colour grade controls** — the Colour workspace renders wheels and curves before those effects exist, previewing synthetic grade entries during live drags and creating the real GPU effect on commit. Never persist synthetic `__grade:*` ids or attach keyframes to them
- Render-loop, scrubbing, zoom-gesture, prewarm and GPU-device behaviour has a lot of load-bearing code that looks removable: see the `render-pipeline-notes` skill before touching any of it

### UI

- Browser shortcut conflicts (e.g. Ctrl+E) need `eventListenerOptions: { capture: true }` on the hotkey to beat Chrome's default
- `HOTKEY_OPTIONS` sets `preventDefault: true`, so the library consumes keys before the callback. For panel-scoped shortcuts use `onKeyDown` on the element with `tabIndex={-1}` + focus-on-hover + `stopPropagation()`, not a global `useHotkeys` with guards
- Timeline has its own `keydown` listener in `timeline.tsx` — keyboard handlers on child panels must `stopPropagation()`, and the timeline checks `e.defaultPrevented`
- Inline edit cancel (Escape) triggers blur on unmount — use a ref guard so `onBlur` doesn't commit the cancelled value
- **Interface sounds** are synthesized (no audio assets) in `infrastructure/audio/ui-sound/`. To add feedback, call `emitUiSound('<token>')` from `@/shared/ui/ui-sound` at the **action chokepoint** (the store action or toggle callback, not each call site) and emit *intent* (`select`/`confirm`/`delete`/`toggleOn`…), never a specific sound. It is opt-in and off by default, rate-limited, and suppressed while `usePlaybackStore.isPlaying` so chirps never pollute monitored audio
