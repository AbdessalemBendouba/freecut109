import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { usePlaybackStore } from '@/shared/state/playback'
import { DopesheetEditor } from './index'
import {
  mainTimelineScrubActiveRef,
  mainTimelineScrubHandoffFrameRef,
} from '@/shared/timeline/main-timeline-scrub'
import { TIMELINE_LIVE_SCROLL_EVENT } from '@/shared/timeline/live-scroll-sync'

describe('DopesheetEditor playhead overlay', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  beforeEach(() => {
    usePlaybackStore.setState({ currentFrame: 0, previewFrame: null, isPlaying: false })
    mainTimelineScrubActiveRef.current = false
    mainTimelineScrubHandoffFrameRef.current = null
  })

  it('clamps the playhead to the left edge when the current frame is before the viewport', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
      />,
    )

    const clip = screen.getByTestId('dopesheet-playhead-clip')
    const line = screen.getByTestId('dopesheet-playhead-line')

    // columnWidth (248) + 1px for the timeline cells' border-l.
    expect(clip).toHaveStyle({ left: '249px' })
    expect(clip).toHaveClass('overflow-hidden')
    // Playhead should be clamped to 0 (left edge), not negative
    expect(line).toHaveStyle({ left: '0px' })
    expect(screen.getAllByTestId('dopesheet-playhead-line')).toHaveLength(1)
    expect(line.querySelectorAll('span')).toHaveLength(2)
  })

  it('removes the keyframe edge inset from the classic shared timeline axis', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        presentation="classic"
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('dopesheet-playhead-line')).toHaveStyle({ left: '0px' })
  })

  it('shows the shared ruler in graph mode and defers the playhead to the graph', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 100, endFrame: 200 }}
        width={640}
        height={240}
        visualizationMode="graph"
      />,
    )

    expect(screen.getByTestId('dopesheet-ruler')).toHaveClass('cursor-ew-resize')
    // In graph mode the dopesheet overlay playhead is not rendered — the graph
    // draws its own playhead (GraphPlayhead) in the graph's coordinate space.
    expect(screen.queryByTestId('dopesheet-playhead-line')).not.toBeInTheDocument()
  })

  it('lets the shared Edit ruler drag beyond the selected item bounds', () => {
    const onScrub = vi.fn()
    const onScrubStart = vi.fn()
    const onScrubEnd = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={50}
        frameViewport={{ startFrame: -100, endFrame: 100 }}
        clampViewportToContent={false}
        scrubClampToItemBounds={false}
        width={640}
        height={240}
        onScrub={onScrub}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerDown(ruler, { button: 0, pointerId: 7, clientX: 294 })
    fireEvent.pointerMove(ruler, { pointerId: 7, clientX: 350 })
    fireEvent.pointerUp(ruler, { pointerId: 7, clientX: 350 })

    expect(onScrubStart).toHaveBeenCalledOnce()
    expect(onScrub).toHaveBeenNthCalledWith(1, 52)
    expect(onScrub).toHaveBeenLastCalledWith(82)
    expect(onScrubEnd).toHaveBeenCalledOnce()
  })

  it('auto-scrolls a linked timeline while the ruler pointer stays at the edge', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const onScrub = vi.fn()
    const onRulerEdgeScroll = vi.fn((deltaPixels: number) => deltaPixels)
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        totalFrames={300}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        clampViewportToContent={false}
        scrubClampToItemBounds={false}
        width={640}
        height={240}
        onScrub={onScrub}
        onRulerEdgeScroll={onRulerEdgeScroll}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 249,
      y: 0,
      left: 249,
      top: 0,
      right: 640,
      bottom: 22,
      width: 391,
      height: 22,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 9, clientX: 640 })
    expect(frameCallbacks).toHaveLength(1)

    act(() => frameCallbacks.shift()?.(16))
    expect(onRulerEdgeScroll).toHaveBeenCalledOnce()
    expect(onRulerEdgeScroll.mock.calls[0]?.[0]).toBeGreaterThan(0)

    // Flush the coalesced scrub produced by edge scrolling. The pointer has not
    // moved, but its frame advances as the linked viewport pans underneath it.
    act(() => frameCallbacks.shift()?.(32))
    expect(onScrub.mock.calls.length).toBeGreaterThan(1)
    expect(onScrub.mock.lastCall?.[0]).toBeGreaterThan(onScrub.mock.calls[0]?.[0])

    fireEvent.pointerUp(ruler, { pointerId: 9, clientX: 640 })
    animationFrameSpy.mockRestore()
  })

  it('shows a separate skim playhead while keeping the committed playhead in place', () => {
    const onSkim = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={onSkim}
        globalFrameToPixels={() => 123.25}
      />,
    )

    const committed = screen.getByTestId('dopesheet-playhead-line')
    const committedLeft = committed.style.left
    const skim = screen.getByTestId('timeline-preview-scrubber')

    act(() => usePlaybackStore.getState().setPreviewFrame(80, 'item-1'))

    expect(skim.style.display).toBe('')
    expect(skim.style.transform).toBe('translate3d(123.25px, 0, 0)')
    expect(committed.style.left).toBe(committedLeft)

    const ruler = screen.getByTestId('dopesheet-ruler')
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 196 })
    expect(onSkim).toHaveBeenCalledWith(50)
    fireEvent.pointerLeave(ruler, { pointerId: 1, clientX: 196 })
    expect(onSkim).toHaveBeenLastCalledWith(null)
  })

  it('follows an active main timeline scrub without following ordinary hover previews', () => {
    const onSkim = vi.fn()
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={onSkim}
      />,
    )

    const committed = screen.getByTestId('dopesheet-playhead-line')
    const initialLeft = committed.style.left

    act(() => usePlaybackStore.getState().setPreviewFrame(40, 'item-1'))
    expect(committed.style.left).toBe(initialLeft)

    mainTimelineScrubActiveRef.current = true
    act(() => usePlaybackStore.getState().setScrubFrame(60))
    expect(committed.style.left).not.toBe(initialLeft)
    expect(mainTimelineScrubHandoffFrameRef.current).toBe(60)

    // The main timeline clears preview before ending the shared gesture. The
    // lower playhead must keep the final position rather than snapping back.
    const finalLeft = committed.style.left
    act(() => usePlaybackStore.getState().setPreviewFrame(null))
    expect(mainTimelineScrubHandoffFrameRef.current).toBe(60)
    mainTimelineScrubActiveRef.current = false
    expect(committed.style.left).toBe(finalLeft)
  })

  it('repositions the Edit playhead from the live scroll axis without a React render', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 20
    const timelineScrollContainerRef = { current: scrollContainer }
    const globalFrameToPixels = (globalFrame: number) => globalFrame - scrollContainer.scrollLeft

    act(() => usePlaybackStore.getState().setCurrentFrame(150))
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={50}
        playheadFrame={50}
        playheadClampToItemBounds={false}
        itemFrom={100}
        totalFrames={100}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onSkim={() => {}}
        globalFrameToPixels={globalFrameToPixels}
        timelineScrollContainerRef={timelineScrollContainerRef}
      />,
    )

    const committed = screen.getByTestId('dopesheet-playhead-line')
    expect(committed).toHaveStyle({ left: '130px' })

    scrollContainer.scrollLeft = 60
    scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))

    expect(committed).toHaveStyle({ left: '90px' })

    // Edit uses the same clipped global axis as the main timeline. Once the
    // playhead leaves the viewport it keeps moving offscreen instead of pinning
    // to the keyframe sheet edge.
    scrollContainer.scrollLeft = 200
    fireEvent.scroll(scrollContainer)

    expect(committed).toHaveStyle({ left: '-50px' })
  })

  it('compositor-pans keyframe geometry between settled React viewport updates', () => {
    const scrollContainer = document.createElement('div')
    scrollContainer.scrollLeft = 20
    const timelineScrollContainerRef = { current: scrollContainer }
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={20}
      />,
    )

    const rulerSurface = screen.getByTestId('dopesheet-ruler').querySelector(
      '[data-motion-ruler-surface]',
    )
    expect(rulerSurface).toHaveStyle({
      transform: 'translate3d(0px, 0, 0)',
    })

    scrollContainer.scrollLeft = 65
    scrollContainer.dispatchEvent(new Event(TIMELINE_LIVE_SCROLL_EVENT))

    expect(rulerSurface).toHaveStyle({ transform: 'translate3d(-45px, 0, 0)' })
  })

  it('pre-renders ruler marks around the linked viewport for immediate pans', () => {
    const scrollContainer = document.createElement('div')
    const timelineScrollContainerRef = { current: scrollContainer }
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        timelineScrollContainerRef={timelineScrollContainerRef}
        timelinePanBaseScrollLeft={0}
      />,
    )

    const rulerSurface = screen
      .getByTestId('dopesheet-ruler')
      .querySelector('[data-motion-ruler-surface]')
    expect(rulerSurface?.children.length).toBeGreaterThan(10)
  })

  it('hides the skim playhead while scrubbing the keyframe ruler', () => {
    const onSkim = vi.fn((frame: number | null) => {
      usePlaybackStore.getState().setPreviewFrame(frame, frame === null ? null : 'item-1')
    })
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={10}
        frameViewport={{ startFrame: 0, endFrame: 100 }}
        width={640}
        height={240}
        onScrub={() => {}}
        onScrubEnd={() => usePlaybackStore.getState().setPreviewFrame(null)}
        onSkim={onSkim}
      />,
    )

    const ruler = screen.getByTestId('dopesheet-ruler')
    const skim = screen.getByTestId('timeline-preview-scrubber')

    act(() => usePlaybackStore.getState().setPreviewFrame(40, 'item-1'))
    expect(skim.style.display).toBe('')

    fireEvent.pointerDown(ruler, { button: 0, pointerId: 3, clientX: 196 })
    expect(skim.style.display).toBe('none')

    fireEvent.pointerMove(ruler, { pointerId: 3, clientX: 220 })
    expect(skim.style.display).toBe('none')

    fireEvent.pointerUp(ruler, { pointerId: 3, clientX: 220 })
    expect(skim.style.display).toBe('none')

    fireEvent.pointerMove(ruler, { pointerId: 4, clientX: 240 })
    expect(onSkim).toHaveBeenLastCalledWith(expect.any(Number))
    expect(skim.style.display).toBe('')
  })

  it('keeps the navigator in the right viewport column', () => {
    render(
      <DopesheetEditor
        itemId="item-1"
        keyframesByProperty={{ x: [] }}
        currentFrame={0}
        width={640}
        height={240}
      />,
    )

    expect(screen.getByTestId('keyframe-navigator-property-column')).toBeInTheDocument()
    expect(screen.getByTestId('keyframe-navigator-viewport-column')).toContainElement(
      screen.getByTestId('keyframe-navigator-thumb'),
    )
  })
})
