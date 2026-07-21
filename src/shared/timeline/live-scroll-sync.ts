/**
 * Fired synchronously after FreeCut's RAF-driven timeline scroller changes
 * scrollLeft. Native `scroll` can arrive a paint later, which is too late for
 * overlays in a separate panel that must visually share the same axis.
 */
export const TIMELINE_LIVE_SCROLL_EVENT = 'freecut:timeline-live-scroll'
export const TIMELINE_SCRUB_VISUAL_FRAME_EVENT = 'freecut:timeline-scrub-visual-frame'

export interface TimelineScrubVisualFrameDetail {
  frame: number
  source: 'main' | 'keyframe'
}

export function notifyTimelineLiveScroll(container: HTMLElement): void {
  container.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))
}

export function notifyTimelineScrubVisualFrame(
  container: HTMLElement | null | undefined,
  detail: TimelineScrubVisualFrameDetail,
): void {
  container?.dispatchEvent(
    new CustomEvent<TimelineScrubVisualFrameDetail>(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, { detail }),
  )
}
