import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import { TimelinePlayhead } from './timeline-playhead'
import { useZoomStore, _resetZoomStoreForTest } from '../stores/zoom-store'
import { useTimelineStore } from '../stores/timeline-store'

describe('TimelinePlayhead', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      currentFrame: 12,
      currentFrameEpoch: 0,
      isPlaying: false,
      playbackRate: 1,
      loop: false,
      volume: 1,
      muted: false,
      zoom: -1,
      previewFrame: null,
      previewFrameEpoch: 0,
      frameUpdateEpoch: 0,
      previewItemId: null,
      useProxy: true,
      previewQuality: 1,
    })
    useTimelineStore.setState({ fps: 30 })
    _resetZoomStoreForTest()
    useZoomStore.getState().setZoomLevelSynchronized(1)
  })

  it('uses atomic scrub updates while dragging and clears preview on release', async () => {
    const { container } = render(
      <div className="timeline-ruler">
        <TimelinePlayhead inRuler maxFrame={300} />
      </div>,
    )

    const ruler = container.querySelector('.timeline-ruler') as HTMLDivElement | null
    expect(ruler).toBeTruthy()

    ruler!.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 40,
      width: 600,
      height: 40,
      toJSON: () => ({}),
    })

    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement | null
    expect(hitArea).toBeTruthy()

    fireEvent.mouseDown(hitArea!, { clientX: 24, clientY: 8, button: 0 })
    fireEvent.mouseMove(document, { clientX: 120, clientY: 8 })

    await waitFor(() => {
      expect(usePlaybackStore.getState().previewFrame).toBe(36)
      expect(usePlaybackStore.getState().currentFrame).toBe(36)
    })

    fireEvent.mouseUp(document, { clientX: 120, clientY: 8 })

    await waitFor(() => {
      expect(usePlaybackStore.getState().currentFrame).toBe(36)
      expect(usePlaybackStore.getState().previewFrame).toBeNull()
    })
  })

  it('auto-scrolls at the viewport edge while keeping both playheads cursor-locked', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const { container } = render(
      <div className="timeline-container">
        <div className="timeline-ruler">
          <TimelinePlayhead inRuler maxFrame={300} />
        </div>
        <div className="timeline-tracks">
          <TimelinePlayhead maxFrame={300} />
        </div>
      </div>,
    )
    const scrollContainer = container.querySelector('.timeline-container') as HTMLDivElement
    Object.defineProperties(scrollContainer, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1200 },
      scrollLeft: { configurable: true, value: 100, writable: true },
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
    const hitArea = container.querySelector('[style*="width: 20px"]') as HTMLDivElement
    const rulerPlayhead = container.querySelector<HTMLElement>(
      '[data-timeline-playhead="ruler"]',
    )!
    const tracksPlayhead = container.querySelector<HTMLElement>(
      '[data-timeline-playhead="tracks"]',
    )!

    fireEvent.mouseDown(hitArea, { clientX: 300, clientY: 8, button: 0 })
    expect(frameCallbacks).toHaveLength(1)
    frameCallbacks.shift()?.(16)
    const firstScrollLeft = scrollContainer.scrollLeft
    expect(firstScrollLeft).toBeGreaterThan(100)
    expect(Number.parseFloat(rulerPlayhead.style.transform.match(/\(([^p]+)/)?.[1] ?? '0')).toBe(
      299 + firstScrollLeft,
    )
    expect(tracksPlayhead.style.transform).toBe(rulerPlayhead.style.transform)
    expect(frameCallbacks).toHaveLength(1)

    frameCallbacks.shift()?.(32)
    expect(scrollContainer.scrollLeft).toBeGreaterThan(firstScrollLeft)
    expect(Number.parseFloat(rulerPlayhead.style.transform.match(/\(([^p]+)/)?.[1] ?? '0')).toBe(
      299 + scrollContainer.scrollLeft,
    )
    expect(tracksPlayhead.style.transform).toBe(rulerPlayhead.style.transform)

    fireEvent.mouseUp(document, { clientX: 300, clientY: 8 })
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    animationFrameSpy.mockRestore()
  })
})
