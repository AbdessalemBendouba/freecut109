/**
 * Wide-event instrumentation for playback cold start: the window between the
 * user pressing Play and the first advancing frame becoming visibly presented.
 *
 * One measurement is active at a time (playback is a singleton):
 * - `beginPlaybackColdStart` on the store's `isPlaying` false-to-true transition
 * - `markPlaybackColdStart` to attach gate/readiness context
 * - `resolvePlaybackColdStartFrameAdvance` records the first Clock advance
 * - `resolvePlaybackColdStartVisibleFrame` emits when that advancing frame is
 *   actually presented by a visible DOM video or rendered preview canvas
 * - `cancelPlaybackColdStart` emits an aborted start that never presented
 *
 * A measurement overlapping a hidden tab is retained but flagged so it can be
 * excluded from cold-start analysis.
 */
import { createLogger, createOperationId, type WideEvent } from '@/shared/logging/logger'

const log = createLogger('PlaybackColdStart')

export interface PlaybackColdStartContext {
  startFrame: number
  forceFastScrubOverlay: boolean
  audioContextState: string | null
}

interface ActivePlaybackColdStart {
  event: WideEvent
  startFrame: number
  startMs: number
  hiddenDuringMeasurement: boolean
  firstAdvancedFrame: number | null
}

export type PlaybackColdStartPresentationSource =
  | 'dom_video'
  | 'rendered_overlay'
  | 'composition_paint'

let active: ActivePlaybackColdStart | null = null

function readVisibilityState(): DocumentVisibilityState | 'unknown' {
  return typeof document !== 'undefined' ? document.visibilityState : 'unknown'
}

function handleVisibilityChange(): void {
  if (active && readVisibilityState() === 'hidden') {
    active.hiddenDuringMeasurement = true
  }
}

function watchVisibility(): void {
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', handleVisibilityChange)
}

function unwatchVisibility(): void {
  if (typeof document === 'undefined') return
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

export function beginPlaybackColdStart(
  ctx: PlaybackColdStartContext,
  nowMs: number = performance.now(),
): void {
  if (active) {
    emit('cancelled', 'superseded_by_new_play', nowMs)
  }
  const event = log.startEvent('playback_cold_start', createOperationId())
  const visibility = readVisibilityState()
  event.merge({
    start_frame: ctx.startFrame,
    force_fast_scrub_overlay: ctx.forceFastScrubOverlay,
    audio_context_state: ctx.audioContextState ?? 'unavailable',
    visibility_state_at_play: visibility,
  })
  active = {
    event,
    startFrame: ctx.startFrame,
    startMs: nowMs,
    hiddenDuringMeasurement: visibility === 'hidden',
    firstAdvancedFrame: null,
  }
  watchVisibility()
}

/** Attach gate/readiness context to the active measurement. */
export function markPlaybackColdStart(data: Record<string, unknown>): void {
  active?.event.merge(data)
}

/** Record the first Clock frame that advanced past the play-start frame. */
export function resolvePlaybackColdStartFrameAdvance(
  frame: number,
  nowMs: number = performance.now(),
): void {
  if (!active || active.firstAdvancedFrame !== null || frame === active.startFrame) return
  active.firstAdvancedFrame = frame
  active.event.merge({
    first_advanced_frame: frame,
    ms_to_first_frame_advance: Math.round(nowMs - active.startMs),
  })
}

/**
 * Complete the measurement when an advancing frame is visibly presented.
 * Returns true only when this call completed the active measurement.
 */
export function resolvePlaybackColdStartVisibleFrame(
  frame: number,
  source: PlaybackColdStartPresentationSource,
  nowMs: number = performance.now(),
): boolean {
  if (!active || active.firstAdvancedFrame === null || frame === active.startFrame) {
    return false
  }
  active.event.merge({
    first_visible_frame: frame,
    first_visible_frame_source: source,
    ms_to_first_visible_frame: Math.round(nowMs - active.startMs),
  })
  emit('completed', null, nowMs)
  return true
}

/** Playback stopped before an advancing frame was presented. */
export function cancelPlaybackColdStart(reason: string, nowMs: number = performance.now()): void {
  if (!active) return
  emit('cancelled', reason, nowMs)
}

function emit(result: 'completed' | 'cancelled', cancelReason: string | null, nowMs: number): void {
  if (!active) return
  if (result === 'cancelled') {
    active.event.merge({ ms_to_cancel: Math.round(nowMs - active.startMs) })
    if (cancelReason !== null) {
      active.event.merge({ cancel_reason: cancelReason })
    }
  }
  active.event.merge({ hidden_during_measurement: active.hiddenDuringMeasurement })
  active.event.success({ result })
  active = null
  unwatchVisibility()
}

/** Test/runtime hook: true while awaiting first visible presentation. */
export function isPlaybackColdStartPending(): boolean {
  return active !== null
}
