---
name: render-pipeline-notes
description: FreeCut's preview/playback render-loop, scrubbing, zoom and GPU-pipeline behaviour — the empirical findings behind code that looks removable but isn't. Read before touching the scrub/pump render loop, transition playback, decoder prewarm, filmstrip/waveform rendering, zoom-gesture handling, thumbnail or scope capture, or when profiling the timeline.
---

# Render pipeline & preview perf notes

Everything here came out of profiling. The code these notes describe frequently looks
redundant or over-complicated in isolation — it isn't, and the measurements are recorded
so nobody re-derives them the hard way. The short invariants live in the root `CLAUDE.md`;
this file is the reasoning.

## Render loop concurrency

`pumpRenderLoop` uses a single mutex (`scrubRenderInFlightRef`) to prevent concurrent pump
iterations during scrubbing. A `scrubRenderGenerationRef` counter is bumped **only** on
playback-start force-clear, never during scrub. The `finally` block releases the lock and
triggers follow-up work only when the generation still matches; stale pumps (from a
superseded playback-start) deliberately leave the lock for the new owner.

**Never bump the generation or force-clear the lock on sequential scrub frames** — that
causes unbounded concurrent pumps.

## Fast scrub and decoder prewarm

Prewarm frames use WASM decode (40-80ms) and block the loop from processing priority
frames. During playback, skip prewarm entirely (`isPlaying` check): priority frames render
fast via DOM video zero-copy (~1ms) and the loop must stay responsive.

Background worker preseek (`backgroundPreseek` in `decoder-prewarm.ts`) also fires on large
timeline jumps (>3s) for all visible clips — the worker decodes off-thread and the render
engine picks up the cached bitmap.

## Transition playback

- **Participant video hold** — during a transition the incoming clip's DOM video element is
  paused by `video-content.tsx` premount logic. The transition provider marks it with
  `data-transition-hold="1"` and calls `.play()` so the canvas renderer gets advancing
  frames; the mark is removed in `clearTransitionPlaybackSession`. Without this the incoming
  clip shows a frozen frame for the whole transition.
- **Prearm covers all types** — the `forceFastScrubOverlay` subscription uses
  `getPlayingAnyTransitionPrewarmStartFrame` (not the complex-only variant) so every
  transition gets its session pinned and its DOM video elements playing before entry. It
  also checks `getTransitionWindowForFrame` to handle playback starting *inside* an already
  active transition.

## Zoom gestures

- **Clip content tracks SETTLED zoom.** `ClipContent` (`timeline-item/clip-content.tsx`)
  drives filmstrip/waveform width from `contentPixelsPerSecond` (settled, updates ~100ms
  after the gesture ends), **not** the live per-frame `pixelsPerSecond`. The clip shell
  resizes smoothly during the gesture via the `--timeline-px-per-frame` CSS variable (no
  React involved). Driving content from live pps rebuilds the filmstrip tile grid on every
  wheel/momentum frame — that was ~73% of zoom cost. During the gesture the content sits
  briefly at pre-zoom scale, hidden by the repeating cover-frame background (zoom-in) or
  `overflow:hidden` clipping (zoom-out), and snaps sharp on settle.
- `preferImmediateRendering` opts back into live pps for active edit previews (trim/slide),
  where settle lag would distract.
- **Deferral is per-canvas, not per-clip.** `isZoomInteracting` (zoom store) is read via
  `getState()` and **never subscribed to** — see `clip-waveform/adaptive-render-version.ts`,
  which draws coarse during the gesture and re-renders sharp on settle. Reading at mount
  rather than subscribing is the whole point: already-mounted clips must not re-render when
  the flag flips, or they flash empty mid-gesture.

## GPU pipeline

`EffectsPipeline.requestCachedDevice()` caches the WebGPU adapter + device globally, so
subsequent `EffectsPipeline.create()` calls reuse the device (~50-100ms saved). The
device-loss handler checks identity before clearing, to avoid discarding a freshly acquired
device. The preview component eagerly warms the pipeline on mount, in parallel with media
resolution.

## Frame capture

- **Reuse rendered frames.** The preview scrub renderer already holds fully composited
  frames with effects/masks/blend modes applied. Anything needing the current frame
  (thumbnails, scopes, snapshots) should call
  `usePreviewBridgeStore.getState().captureCanvasSource()` first and fall back to
  `renderSingleFrame()` only when the preview is unavailable. Never spin up a second render
  pipeline for a frame that already exists.
- **Progressive downscaling.** When scaling high-res canvases to small sizes (1920→320
  thumbnails), halve repeatedly instead of one large jump. Single-step downscaling causes
  moire/aliasing against high-frequency GPU effects (halftone, pixelate, …).

## Profiling

- `window.__DEBUG__` (DEV-only, tree-shaken in prod) is defined in `src/app/debug/project-debug.ts`
  — store dumps, transition/playback introspection, fixtures, playback control, and
  `perfSummary(prefix?)` / `perfClear()`. All entries lazy `await import()` so stores aren't
  pulled in eagerly. Read the file for the current surface rather than trusting any list.
- `withPerfMeasure(name, fn)` (`src/shared/logging/perf-marks.ts`) wraps hot paths so they
  appear on the User Timing track in Chrome DevTools. It instruments `tl.action.*` (every
  timeline mutation, via `actions/shared.ts::execute`), `tl.repairTransitions`, and the RAF
  loops `tl.raf.*`. Gated on `window.__TL_PERF__ = true` — **off by default, zero overhead** —
  so the User Timing buffer doesn't grow unbounded in normal use.
- `perfMarkRender(name)` adds per-render `tl.render.*` marks to the high-fanout components
  (ClipContent, TimelineItem, TimelineTrack, TimelineContent, TimelineMarkers,
  TimelinePlayhead, TransitionItem), gated on `window.__TL_RENDER_MARKS__ = true`, for
  working out which components re-render during a gesture.
- Set the flag, then `npm run perf`, then read marks via the Performance tab or
  `__DEBUG__.perfSummary()`.

## Measuring at all

Playback FPS is **not** reliably measurable through an automation/CI browser tab — identical
frames have measured anywhere from 1.3 to 22fps. Measure GPU cost via export frame-times
instead. Hidden or occluded tabs also suspend rAF, so check `document.visibilityState`
before trusting any browser-side timing.
