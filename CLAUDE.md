# FreeCut Web

## Commands

```bash
npm run dev          # Vite dev server on port 5173
npm run build        # Production build
npm run lint         # Oxlint
npm run format       # Oxfmt
npm run format:check # Check formatting with Oxfmt
npm run test         # Vitest (watch mode)
npm run test:run     # Vitest (single run)
npm run routes       # Regenerate TanStack Router tree (tsr generate)
```

## Architecture

Browser-based multi-track video editor. React 19 + TypeScript + Vite.

```text
src/
├── features/              # User-facing UI modules
│   ├── editor/            # Editor shell, toolbar, panels, stores
│   ├── timeline/          # Multi-track timeline, actions, services
│   ├── preview/           # Preview canvas, transform gizmo, scrub renderer
│   ├── export/            # WebCodecs export pipeline (Web Worker)
│   ├── effects/           # GPU effect UI panels and registry
│   ├── keyframes/         # Keyframe animation, Bezier editor, easing
│   ├── media-library/     # Media import, metadata, OPFS proxies, transcription
│   ├── project-bundle/    # Project ZIP export/import
│   ├── projects/          # Project management
│   ├── scene-browser/     # Caption and scene search UI
│   ├── settings/          # App settings
│   └── workspace-gate/    # Workspace picker / permission gate
├── runtime/               # Playback and rendering engines (not user-facing UI features)
│   ├── composition-runtime/ # Composition rendering (sequences, items, audio, transitions)
│   └── player/            # Clock, video source pools, composition playback
├── infrastructure/        # Platform adapters — browser, storage, GPU, ML, audio
│   ├── gpu-effects/       # WebGPU effect pipeline + shader definitions
│   ├── gpu-transitions/   # WebGPU transition pipeline + shaders
│   ├── gpu-compositor/    # WebGPU blend-mode compositor
│   ├── gpu-masks/         # Mask combine pipeline + texture manager
│   ├── gpu-media/         # Media render/blend pipelines
│   ├── gpu-scopes/        # Waveform/vectorscope/histogram renderers
│   ├── gpu-shapes/        # Shape render pipeline
│   ├── gpu-text/          # Glyph-atlas text pipeline
│   ├── gpu-shared/        # WGSL fragments shared across GPU modules
│   ├── analysis/          # Scene detection, captioning, embeddings, optical flow
│   ├── audio/             # SoundTouch-based time-stretch
│   ├── browser/           # Blob URLs, OPFS, mediabunny adapter
│   ├── storage/           # Workspace FS persistence + legacy IDB migration
│   └── thumbnails/        # GPU thumbnail renderer + sampling strategy
├── shared/                # Framework-agnostic primitives + cross-feature state
│   ├── timeline/          # Transition engine/registry/renderers, defaults
│   ├── projects/          # Schema migrations and normalization
│   ├── state/             # Zustand stores (playback, selection, dialogs, editor)
│   ├── marquee/           # Marquee-selection hook + overlay (paired unit)
│   ├── logging/           # Structured logger, frame jitter monitor
│   ├── ui/                # cn helper, property controls
│   ├── typography/        # Font loading, text style presets
│   ├── graphics/          # Shape generators and path helpers
│   └── utils/             # Managed workers, color/curve math, easing, async, etc.
├── components/            # shadcn/ui components + brand assets
├── app/                   # App bootstrap, error boundary, PWA prompt, debug
├── config/                # Hotkeys + editor layout config
├── i18n/                  # i18next setup, supported languages, locale JSON + per-feature partials
├── routes/                # TanStack Router (file-based, auto-generated routeTree)
└── types/                 # Shared TypeScript types
```

## Key Patterns

- **State**: Zustand stores + Zundo for undo/redo
- **Timeline store split**: `useTimelineStore` (from `timeline-store.ts`) is a **facade** over domain stores (`items-store`, `transitions-store`, `keyframes-store`, `markers-store`, `timeline-settings-store`, `timeline-command-store`). Components use the facade with selectors; action code accesses domain stores via `.getState()` directly
- **Timeline mutations**: Action modules in `features/timeline/stores/actions/*.ts` use `execute()` wrapper from `shared.ts` for undo/redo integration. Never mutate timeline stores directly — use these actions
- **TimelineItem composition**: The per-clip component in `features/timeline/components/timeline-item/index.tsx` delegates to dedicated hooks: `useCaptionDialogState`, `useFadeEditors`, `useFadeMath`, `useEditPreviewShifts`, `useTimelineItemBounds`, `useSmartTrimHover`, `useContextMenuState`, plus the existing `useTimelineItemActions` / `useTimelineItemDropHandlers` / `useDragVisualState`. The host file orchestrates these hooks and renders the JSX; sub-components live alongside (`EdgeHalos`, `TransitionDropGhost`, `TranscribeDialogController`, etc.). When adding new clip state, prefer a new hook over inlining
- **Timeline item types**: `TimelineItem` is a discriminated union on `type`: `video | audio | text | image | shape | adjustment | composition` — GIFs use `image` type, no separate gif type. Types in `src/types/timeline.ts`
- **Item positioning**: Remotion convention — `from` (start frame in project FPS) + `durationInFrames`
- **Compositions**: Pre-compositions (sub-comps) have dedicated stores (`compositions-store.ts`, `composition-navigation-store.ts`). 1-level nesting only. Actions in `composition-actions.ts`
- **Migrations**: `src/shared/projects/migrations/` — versioned migrations + normalization run on every project load. Increment `CURRENT_SCHEMA_VERSION` in `types.ts` when adding new migrations
- **Routing**: TanStack Router — run `npm run routes` after adding/changing route files
- **Path alias**: `@/*` → `src/*`
- **i18n**: i18next + react-i18next, initialized in `src/i18n/index.ts` (imported once from `main.tsx`). 9 languages (`en`, `es`, `fr`, `de`, `pt-BR`, `tr`, `ja`, `ko`, `zh`) in `src/i18n/languages.ts`. Base strings in `src/i18n/locales/<lang>.json`; per-feature strings live in `src/i18n/locales/partials/<lang>/<name>.json` (file contains the slice directly with no language wrapper key). `en` partials are eagerly bundled into `app-shell`; all other languages load on demand via `loadLanguageResources(lang)` / `changeAppLanguage(lang)` from `@/i18n`. The user's persisted language is preloaded before first render via the exported `i18nReady` promise. In components use `const { t } = useTranslation()`; outside React use `import { i18n } from '@/i18n'` then `i18n.t()` (`@/i18n` is allowed by the boundary checks — it's not `@/features/*`). For strings with inline markup use `<Trans i18nKey=... components={{ strong: <strong/> }} />`. Resources are deliberately untyped (`i18next.d.ts`) so `t()` accepts any key. Language selector lives in the editor Settings dialog (General); persisted to `localStorage` key `freecut-language` by the language detector. When adding new partials, translate all 9 languages and keep identical key structure across all language dirs; never put a bare ASCII `"` inside a JSON string value.
- **Styling**: Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **Media processing**: Mediabunny for decode, WebCodecs for export, Web Workers for heavy ops
- **Storage**: Workspace folder via File System Access API (see `infrastructure/storage/workspace-fs/`). Source of truth is a user-picked directory on disk — projects, media metadata, thumbnails, waveforms, gif frames, decoded audio, transcripts all live as plain files. `WorkspaceGate` (`src/features/workspace-gate/`) blocks app render until a workspace is granted. IndexedDB is only used for a tiny handle registry (`freecut-handles-db` v1, at `infrastructure/storage/handles-db.ts`) that stores non-serializable `FileSystem*Handle` references. Legacy `video-editor-db` is read only by the one-time migration path under `infrastructure/storage/legacy-idb/` (reader.ts + migrate.ts); consumers import from the barrel `@/infrastructure/storage` which routes everything to workspace-fs

## Code Style

- Strict TypeScript (`noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`)
- `no-console` rule — always use `createLogger` from `src/shared/logging/logger.ts`, never raw `console.*` calls
- **Logging**: Use wide event pattern for multi-step operations (export, import, save): `log.startEvent(name, opId)` accumulates context, emits one structured event via `.success()` / `.failure()`. Use `createOperationId()` for correlation. Include business context (project ID, item counts, codec, resolution) in events
- `typescript/no-explicit-any` warned by Oxlint

## Testing

- Vitest + jsdom + @testing-library/react
- `src/test/setup.ts` mocks ImageData, WebGPU APIs (`navigator.gpu`), and GPU constants
- Tests live next to source files: `*.test.ts` / `*.test.tsx`
- **Pure-logic tests opt out of jsdom.** `vite.config.ts` defaults to `environment: 'jsdom'`, but a test that never touches `document` / `window` / `navigator` / testing-library should start with `// @vitest-environment node` on line 1 (blank line after). Building a jsdom per file is ~30% of the suite's wall clock; 280 files already do this. Keep the jsdom default — a file wrongly marked `node` fails loudly with `document is not defined`, whereas flipping the default would silently break any file someone forgot to annotate. Leave a file on jsdom if it merely *mentions* `window`/`navigator`: a `typeof window !== 'undefined'` branch would take the non-browser path with every assertion still green
- **Only write tests that exercise real logic.** A test must be able to fail for a reason other than someone editing a constant or a string. Do NOT add tests that: re-assert a static config/registry/preset constant back to itself (config snapshots); assert `typeof x === 'function'` or `has correct initial state` on a store; only verify a mocked function was called / returned its mock value (the real code is stubbed, so nothing real is covered); render a component and assert a passed-in prop/className/style string appears with no branching behind it; exercise library/framework behavior (Radix, jsdom events, controlled inputs). When the only collaborators are mocked, test against the real in-memory fake (e.g. workspace-fs round-trips) instead. Worth testing: algorithm/math (FPS/timeline conversions, transitions, interpolation, color/curve math), reducer/state-machine transitions, schema migrations, edge/boundary cases, and named regressions. If unsure whether a test adds value, prefer no test over a low-value one

## Environment

- `VITE_SHOW_DEBUG_PANEL=false` — set to hide debug panel in dev mode (shown by default)

## Toolchain & dependency notes

- The entire dev/build/test/lint/format stack runs through **vite-plus** (`vp`, currently 0.x / pre-1.0) — it wraps Vite, Vitest, Oxlint, Oxfmt and the task runner. There is no plain-Vite fallback configured; if `vp` breaks, pin the last working version in package.json rather than attempting an ad-hoc migration
- `onnxruntime-web` is intentionally pinned to a **dev build** (`1.26.0-dev.*`) — introduced with the supertonic TTS integration. Don't "upgrade" it casually; moving to a stable release requires re-validating transcription, TTS and scene detection
- `lucide-react` is held at 0.468.x deliberately (Vite pre-bundles it; see Gotchas about `optimizeDeps`). A major-version bump is a deliberate task, not a routine dep update
- All production deps are exact-pinned; keep new deps exact-pinned too (no `^`/`~`)
- **TypeScript 7 needs the `overrides.typescript` entry.** `i18next` and `react-i18next` declare `peerOptional typescript@"^5"`, so any TS >= 6 fails a clean `npm install`/`npm ci` with ERESOLVE (an *incremental* install over an existing tree misleadingly succeeds). The override in package.json forces one TS copy and must be bumped in lockstep with the `typescript` devDependency. `@voidzero-dev/vite-plus-core` also peers `^5 || ^6`, but never loads the package — it shells out to the tsgolint binary — so that one is inert
- Type checking does **not** run `tsc`. `vp check` type-checks via **tsgolint** (the TypeScript-Go engine), which is why CI already had native-speed checking before the TS 7 bump. Nothing in `package.json` scripts or CI invokes `tsc`; the `typescript` devDependency exists for editor tsserver and ad-hoc `npx tsc`. TS 7.0 ships no stable programmatic API — if a tool ever needs one, alias `@typescript/typescript6`
- **The fallow allowlists are baselines, not approvals.** `check:unused-exports` and `check:unused-class-members` are ratchets: they fail only on findings *new* since the baseline, plus stale entries. Every entry carries a `reason`, and re-baselined ones are tagged — `parked-ai-feature` (the unwired assistant, see `ai-tab.tsx`), `deps-contract` (adapter surface the boundary rules require), `barrel-surface` (feature `index.ts` public API), `unreviewed` (never traced; start here when cleaning up). Never bulk-`fallow fix` these — trace per export. Re-baseline by regenerating both files from `fallow dead-code --format json`, preserving existing reasons; a stale baseline makes the gate fail permanently and get ignored
- `oxlint` / `oxfmt` / `@oxc-project/types` are **not** direct deps — vite-plus exact-pins them internally, so they only move when `vp` moves. A `vp` bump can therefore reformat the tree (0.2.4 brought oxfmt 0.57 and reflowed 52 files); land that churn as its own commit

## Git

- `main` — production, `staging` — pre-release integration, `develop` — active development
- PR target: `staging` (feature branches and `develop` PR into `staging`; `staging` is promoted to `main` for release). Do **not** open PRs against `main` directly
- Commit messages: conventional commits — `type(scope): description` (e.g. `fix(timeline):`, `feat(export):`)

## Gotchas

- Track groups are 1-level only (no nested groups). Gate behavior (mute/visible/locked) propagates from group to children via `resolveEffectiveTrackStates()` in `group-utils.ts`
- Browser shortcut conflicts (e.g. Ctrl+E) need `eventListenerOptions: { capture: true }` on the hotkey to override Chrome's default behavior
- Feature modules use `index.ts` barrel files to define public API surface — follow this convention when adding new features
- `routeTree.gen.ts` is auto-generated — don't edit manually
- `*.mp4` files are gitignored
- Vite pre-bundles `lucide-react` to avoid analyzing 1500+ icons — don't remove from `optimizeDeps`
- WebGPU tests need mocks from `src/test/setup.ts` — tests will fail without jsdom environment
- Build uses manual chunk splitting — check `vite.config.ts` when adding large dependencies
- `HOTKEY_OPTIONS` has `preventDefault: true` — the library consumes keys before the callback. For panel-scoped shortcuts, use `onKeyDown` on the element with `tabIndex={-1}` + focus-on-hover + `stopPropagation()`, not global `useHotkeys` with guards
- `sourceStart`/`sourceEnd`/`sourceDuration` on timeline items are in **source-native FPS** frames, not project FPS. Use media's `fps` from media library store when converting to seconds
- Track `order` convention: lower value = visually higher (top of timeline). New tracks go at `minOrder - 1`. When creating pre-comps, place the comp item on the bottom-most (highest order) selected track; dissolve expands upward
- Group tracks (`isGroup: true`) are headers only — never place items on them. Filter them out when searching for candidate tracks
- Inline edit cancel (Escape) triggers blur on unmount — use a ref guard to prevent `onBlur` from committing the cancelled value
- `_splitItem()` returns `{ leftItem, rightItem } | null` — capture the return for correct IDs; the original item ID is stale after split
- Timeline has its own `keydown` listener in `timeline.tsx` — new keyboard handlers on child panels must `stopPropagation()` and timeline checks `e.defaultPrevented`
- **Effects are GPU-only** — all visual effects use WebGPU shaders (`type: 'gpu-effect'`). Legacy CSS filter, glitch, halftone, vignette, LUT types were removed in v6 migration. Effect definitions in `src/infrastructure/gpu-effects/effects/`, pipeline in `effects-pipeline.ts`. Specialized UI panels exist for `gpu-curves` and `gpu-color-wheels`; all others use the generic `GpuEffectPanel`
- **Transitions are GPU-only** — all 13 transitions (fade, wipe, slide, flip, clockWipe, iris, dissolve, sparkles, glitch, lightLeak, pixelate, chromatic, radialBlur) render via WebGPU shaders in `infrastructure/gpu-transitions/`. Each renderer in `shared/timeline/transitions/renderers/` has `gpuTransitionId` linking to its shader, plus a `renderCanvas()` Canvas 2D fallback for non-WebGPU environments. `calculateStyles()` is dead code (CSS/DOM transition rendering was removed). Canvas `drawImage` offsets must use `Math.round()` to avoid sub-pixel interpolation artifacts
- After clip edits that change position/duration, call `applyTransitionRepairs(changedClipIds)` from `shared.ts` — transitions auto-heal or report breakages
- `shared/logging/logger.ts` uses only `function` declarations (no `class`/`const` at module scope) to avoid temporal dead zone errors in production chunk ordering — maintain this pattern
- Fast scrub render loop: prewarm frames use WASM decode (40-80ms) and block the loop from processing priority frames. During playback, skip prewarm entirely (`isPlaying` check) — priority frames render fast via DOM video zero-copy (~1ms) and the loop must stay responsive. Background worker preseek (`backgroundPreseek` in `decoder-prewarm.ts`) also fires on large timeline jumps (>3s) for all visible clips — the worker decodes off-thread and the render engine picks up the cached bitmap
- **Render loop concurrency** — `pumpRenderLoop` uses a single-mutex (`scrubRenderInFlightRef`) to prevent concurrent pump iterations during scrubbing. A `scrubRenderGenerationRef` counter is bumped ONLY on playback-start force-clear (not during scrub). The `finally` block releases the lock and triggers follow-up work only when the generation matches; stale pumps (from a superseded playback-start) leave the lock for the new owner. Never bump generation or force-clear the lock on sequential scrub frames — this causes unbounded concurrent pumps. The `data-transition-hold` attribute on DOM video elements coordinates with `video-content.tsx` premount logic and `clearTransitionPlaybackSession` cleanup
- **Transition participant video hold** — during transitions, the incoming clip's DOM video element is paused by `video-content.tsx` premount logic. The transition provider marks it with `data-transition-hold="1"` and calls `.play()` so the canvas renderer gets advancing frames. The mark is removed in `clearTransitionPlaybackSession`. Without this, the incoming clip shows a frozen frame during the transition
- When updating multiple GPU effect params atomically (e.g. color wheel hue + amount), use `onParamsBatchChange`/`onParamsBatchLiveChange` — calling `onParamChange` twice reads stale state on the second call and overwrites the first
- **Reuse rendered frames** — the preview scrub renderer already has fully composited frames with effects/masks/blend modes. Features needing the current frame (thumbnails, scopes, snapshots) should use `usePreviewBridgeStore.getState().captureCanvasSource()` first, falling back to `renderSingleFrame()` only when the preview is unavailable. Never spin up a new render pipeline when an existing one already has the frame
- **Progressive downscaling** — when scaling high-res canvases to small sizes (e.g. 1920→320 thumbnails), halve dimensions repeatedly instead of one large jump. Single-step downscaling causes moire/aliasing with high-frequency GPU effects (halftone, pixelate, etc.)
- `StableVideoSequence`'s `areGroupPropsEqual` (defined in `stable-video-sequence-comparator.ts`, consumed by `stable-video-sequence.tsx`) whitelists item properties for React.memo comparison. When adding new visual properties to `TimelineItem`, add them to this comparison — missing properties cause stale renders during playback
- **GPU pipeline caching** — `EffectsPipeline.requestCachedDevice()` caches the WebGPU adapter + device globally. Subsequent `EffectsPipeline.create()` calls reuse the device (~50-100ms saved). The device-loss handler checks identity before clearing to avoid discarding a freshly acquired device. The preview component eagerly warms the GPU pipeline on mount (parallel with media resolution)
- **`__DEBUG__` API** — `window.__DEBUG__` (DEV-only, tree-shaken in prod) provides console debugging: `stores()`, `getTransitions()`, `getTransitionWindows()`, `getPlaybackState()`, `getTracks()`, `getMediaLibrary()`, `jitter()` (frame timing), `previewPerf()`, `transitionTrace()`, `prewarmCache()`, `filmstripMetrics()`, `perfSummary(prefix?)` / `perfClear()` (User Timing aggregation, default prefix `tl.`), plus playback control (`seekTo`, `play`, `pause`). All use lazy `await import()` to avoid pulling in stores eagerly
- **Timeline perf-marks** — `withPerfMeasure(name, fn)` in `src/shared/logging/perf-marks.ts` wraps hot paths so they appear as named entries on the User Timing track in Chrome DevTools Performance. Currently instruments `tl.action.*` (every timeline mutation, via `actions/shared.ts::execute`), `tl.repairTransitions`, and the RAF loops `tl.raf.{viewportSync,previewHover,zoomApply,scrollThumb,momentum,playheadScrub}`. `withPerfMeasure` is opt-in — gated on `window.__TL_PERF__ = true` (off by default, zero overhead) so the User Timing buffer doesn't grow unbounded in normal use; set the flag before profiling (`npm run perf`), then read marks via the Performance tab or `__DEBUG__.perfSummary()`. `perfMarkRender(name)` adds per-render `tl.render.*` marks to the high-fanout components (ClipContent, TimelineItem, TimelineTrack, TimelineContent, TimelineMarkers, TimelinePlayhead, TransitionItem) — gated on `window.__TL_RENDER_MARKS__ = true` (off by default, zero overhead) for diagnosing which components re-render during a gesture
- **Clip content tracks SETTLED zoom** — `ClipContent` (`timeline-item/clip-content.tsx`) drives filmstrip/waveform width from `contentPixelsPerSecond` (settled, updates ~100ms after a zoom gesture ends), NOT the live per-frame `pixelsPerSecond`. The clip shell resizes smoothly during the gesture via the `--timeline-px-per-frame` CSS variable (no React); the filmstrip tile grid would otherwise rebuild on every wheel/momentum frame (~73% of zoom cost). During the gesture the content is briefly at pre-zoom scale, hidden by the repeating cover-frame background (zoom-in) or `overflow:hidden` clipping (zoom-out), snapping sharp on settle. The `preferImmediateRendering` prop opts back into live pps for active edit previews (trim/slide) where settle lag would distract
- **Clip content defers mount during zoom** — `ClipContent` also reads `isZoomInteracting` **once at mount** via `getState()` (not a reactive subscription) into `deferVisual` state. A clip that first mounts mid-gesture (e.g. entering the viewport while zooming out) renders only its colored shell — no filmstrip/waveform — until the zoom settles, then a one-shot `useZoomStore.subscribe` flips it on. This was ~90% of zoom-OUT cost: zooming out brings many clips into view at once and mounting each one's tile grid + canvas draws stalled the gesture (226ms/frame → ~42ms/frame). Reading at mount (not subscribing) is critical — already-mounted clips must NOT re-render when `isZoomInteracting` flips, or they'd flash empty
- **Transition prearm covers all types** — the `forceFastScrubOverlay` subscription uses `getPlayingAnyTransitionPrewarmStartFrame` (not complex-only) so all transitions get their session pinned and DOM video elements playing before entry. Also checks `getTransitionWindowForFrame` for playback starting inside an active transition
- **Feature boundary rules** — cross-feature imports must go through `deps/` adapter modules. The pre-push hook enforces this via `check:boundaries`. (A `check:legacy-lib-imports` tripwire also catches any reintroduction of `@/lib/*` imports — the `src/lib/` layer was removed and merged into `infrastructure/`.)
- **GPU effect data textures**: effects that need LUT-like auxiliary data declare `dataTexture` in their `GpuEffectDefinition`. The pipeline binds it at `@group(0) @binding(3)`, caches the texture per pass, rewrites same-size contents with `queue.writeTexture`, and invalidates bind groups only when dimensions change. `gpu-curves` uses this for the 256x1 curve LUT; `gpu-lut` embeds resampled `.cube` data in effect params so project bundles and export workers need no side channel.
- **Implicit color grade controls**: the Color workspace renders wheels and curves even before those effects exist. `ColorGradeSection` previews synthetic grade entries through the gizmo effects-preview path during live drags, then lazily creates the real GPU effect on commit. Do not persist synthetic `__grade:*` ids or attach keyframes to them.
- **Interface sounds**: synthesized (no audio assets) via a dedicated `AudioContext` in `infrastructure/audio/ui-sound/` (`synth.ts` data-only `Recipe` → `renderRecipe`; `voices.ts` maps semantic `SoundToken`s → recipes per swappable **voice**; `engine.ts` owns the lazy context + per-token rate limit). To add feedback anywhere call `emitUiSound('<token>')` from `@/shared/ui/ui-sound` at the **action chokepoint** (the store action / toggle callback, not each call site) — emit *intent* (`select`/`confirm`/`delete`/`toggleOn`…), never a specific sound. It's gated: opt-in + volume-scaled via `useUiSoundStore` (`shared/state/ui-sound-store.ts`, persisted `freecut-ui-sound`, **off by default**), rate-limited, and **suppressed while `usePlaybackStore.isPlaying`** so chirps never pollute monitored audio (exports are silent by construction — the export worker never imports the module). New voices: add to `VOICES`/`VOICE_OPTIONS` + `VoiceName` and the picker (Settings → General) updates automatically. `previewUiSound(voice, token)` auditions a specific voice without committing it. `hover` is defined but intentionally unwired (too noisy for blanket use).
