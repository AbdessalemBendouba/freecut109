import { describe, expect, it } from 'vite-plus/test'
import { shouldWaitForMiniTimelinePreview } from './scrub-backpressure'

describe('shouldWaitForMiniTimelinePreview', () => {
  it('holds newer scrub targets while the requested overlay frame is rendering', () => {
    expect(
      shouldWaitForMiniTimelinePreview({
        lastRequestedFrame: 120,
        displayedFrame: 90,
        elapsedMs: 40,
      }),
    ).toBe(true)
  })

  it('releases immediately when the requested frame is displayed', () => {
    expect(
      shouldWaitForMiniTimelinePreview({
        lastRequestedFrame: 120,
        displayedFrame: 120,
        elapsedMs: 40,
      }),
    ).toBe(false)
  })

  it('does not block player-only previews that have no rendered overlay frame', () => {
    expect(
      shouldWaitForMiniTimelinePreview({
        lastRequestedFrame: 120,
        displayedFrame: null,
        elapsedMs: 40,
      }),
    ).toBe(false)
  })

  it('escapes a stalled renderer after the wait timeout', () => {
    expect(
      shouldWaitForMiniTimelinePreview({
        lastRequestedFrame: 120,
        displayedFrame: 90,
        elapsedMs: 400,
      }),
    ).toBe(false)
  })
})
