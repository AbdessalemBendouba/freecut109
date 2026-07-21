import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import {
  mainTimelineScrubActiveRef,
  resetTimelineSkimmerScrubForTest,
  timelineSkimmerScrubSignal,
} from '@/shared/timeline/main-timeline-scrub'
import { useTimelineStore } from '../stores/timeline-store'
import { TimelineMarkers } from './timeline-markers'

vi.mock('../contexts/timeline-zoom-context', () => ({
  useTimelineCommittedZoomContext: () => ({
    timeToPixels: (time: number) => time * 100,
    frameToPixels: (frame: number) => frame * (100 / 30),
    pixelsPerSecond: 100,
  }),
}))

describe('TimelineMarkers ruler scrub cancellation', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 0,
      previewFrame: null,
      previewItemId: null,
      isPlaying: false,
    })
    useTimelineStore.setState({ fps: 30, inPoint: null, outPoint: null, markers: [] })
    mainTimelineScrubActiveRef.current = false
    resetTimelineSkimmerScrubForTest()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() })),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('releases scrub ownership and cancels the RAF when the window loses focus', async () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const { container } = render(
      <div className="timeline-container">
        <TimelineMarkers duration={10} width={1000} />
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1000 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    })
    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    })
    const ruler = container.querySelector('[style*="cursor: ew-resize"]') as HTMLDivElement
    ruler.getBoundingClientRect = scrollContainer.getBoundingClientRect

    fireEvent.mouseDown(ruler, { button: 0, clientX: 290 })
    expect(mainTimelineScrubActiveRef.current).toBe(true)
    expect(timelineSkimmerScrubSignal.current).toBe(true)
    expect(frameCallbacks).toHaveLength(1)

    fireEvent.blur(window)

    expect(mainTimelineScrubActiveRef.current).toBe(false)
    expect(timelineSkimmerScrubSignal.current).toBe(false)
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    await waitFor(() => expect(document.body.style.cursor).toBe(''))
  })
})
