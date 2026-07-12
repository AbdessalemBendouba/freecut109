// A cold random seek in a long project can legitimately take 150-300ms.
// Keep coalescing to the newest pointer target throughout that work instead of
// admitting another request halfway through. The timeout is only an escape
// hatch for a genuinely stalled renderer.
const MINI_TIMELINE_RENDER_WAIT_TIMEOUT_MS = 400

export function shouldWaitForMiniTimelinePreview({
  lastRequestedFrame,
  displayedFrame,
  elapsedMs,
}: {
  lastRequestedFrame: number | null
  displayedFrame: number | null
  elapsedMs: number
}): boolean {
  if (lastRequestedFrame === null || displayedFrame === null) return false
  if (displayedFrame === lastRequestedFrame) return false
  return elapsedMs < MINI_TIMELINE_RENDER_WAIT_TIMEOUT_MS
}
