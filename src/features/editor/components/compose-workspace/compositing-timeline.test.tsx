import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { MediaMetadata } from '@/types/storage'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useClipboardStore } from '@/shared/state/clipboard'
import { useEditorStore } from '@/shared/state/editor'
import {
  makeTimelineTrack,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/editor/deps/timeline-test-helpers-contract'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useKeyframesStore,
  useKeyframeSelectionStore,
  useTimelineCommandStore,
  openComposition,
  trimItemEnd,
} from '@/features/editor/deps/timeline-motion'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library-contract'
import { useGizmoStore } from '@/features/editor/deps/preview'
import type {
  AudioItem,
  ControllerItem,
  ShapeItem,
  TimelineItem,
  VideoItem,
} from '@/types/timeline'
import { useComposeUiStore } from './compose-ui-store'
import { CompositingTimeline } from './compositing-timeline'

const perfMarkMocks = vi.hoisted(() => ({ mark: vi.fn() }))

vi.mock('@/shared/logging/perf-marks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/logging/perf-marks')>()
  return { ...actual, perfMarkRender: perfMarkMocks.mark }
})

vi.mock('@/features/editor/deps/media-library-contract', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/editor/deps/media-library-contract')>()
  return { ...actual, resolveMediaUrl: vi.fn().mockResolvedValue('blob:motion-media') }
})

function makeDataTransfer(payload: unknown) {
  return {
    getData: (type: string) => (type === 'application/json' ? JSON.stringify(payload) : ''),
    types: ['application/json'],
    dropEffect: 'copy',
  }
}

function openTransformOptions(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Transform options' }), {
    button: 0,
    ctrlKey: false,
  })
}

const track = makeTimelineTrack({ id: 'layer-track', name: 'Rectangle', kind: 'video', order: 0 })
const shape: ShapeItem = {
  id: 'shape-1',
  type: 'shape',
  trackId: track.id,
  from: 0,
  durationInFrames: 120,
  label: 'Hero rectangle',
  shapeType: 'rectangle',
  fillColor: '#22d3ee',
  strokeWidth: 0,
  transform: { x: 100, y: 80, width: 400, height: 220, rotation: 0, opacity: 1 },
}

// The full repository run executes this render-heavy suite under substantial worker contention.
describe('CompositingTimeline', { timeout: 15_000 }, () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {}
    }
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useCompositionsStore.getState().addComposition({
      id: 'comp-1',
      name: 'Motion title',
      editorKind: 'composite-2d',
      tracks: [track],
      items: [shape],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 120,
    })
    useCompositionNavigationStore.getState().switchToSequence('comp-1')
    useMediaLibraryStore.setState({ mediaItems: [], mediaById: {} })
    useComposeUiStore.setState({
      expandedLayerIdsByComposition: {},
      lastOpenedCompositionId: null,
      motionReturnTabCaptured: false,
      motionReturnTabId: null,
    })
    useEditorStore.getState().setWorkspace('motion')
    useClipboardStore.setState({ itemsClipboard: null, transitionClipboard: null })
    useEditorStore.getState().setKeyframeEditorShortcutScopeActive(false)
    useKeyframeSelectionStore.getState().clearSelection()
    useGizmoStore.getState().cancelInteraction()
    useGizmoStore.getState().clearPreview()
    useGizmoStore.getState().setSnappingEnabled(true)
    perfMarkMocks.mark.mockClear()
  })

  afterEach(() => {
    cleanup()
    useGizmoStore.getState().cancelInteraction()
    useGizmoStore.getState().clearPreview()
    useGizmoStore.getState().setSnappingEnabled(true)
    resetTimelineCompositionTestState()
  })

  it('keeps the Motion layer header and expands classic dope-sheet child rows', () => {
    render(<CompositingTimeline />)

    expect(screen.getByTestId('compositing-timeline')).toBeInTheDocument()
    expect(screen.getByText('Parent')).toBeInTheDocument()
    expect(
      within(screen.getByTestId(`motion-parent-cell-${shape.id}`)).getByRole('combobox', {
        name: 'Parent for Hero rectangle',
      }),
    ).toHaveTextContent('None')
    expect(screen.getAllByText('Hero rectangle')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    expect(screen.getByText('Position')).toBeInTheDocument()
    expect(screen.getByText('Opacity')).toBeInTheDocument()
    expect(screen.getByLabelText('Position X')).toHaveValue('100.00')
    expect(screen.getByLabelText('Position Y')).toHaveValue('80.00')
    expect(screen.queryByText('X Position')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transform options' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Separate Position dimensions' }),
    ).not.toBeInTheDocument()
  })

  it('shows a linked audiovisual pair as one Motion layer', () => {
    const videoTrack = makeTimelineTrack({
      id: 'motion-video-track',
      name: 'Interview',
      kind: 'video',
      order: 0,
    })
    const audioTrack = makeTimelineTrack({
      id: 'motion-audio-track',
      name: 'Interview audio',
      kind: 'audio',
      order: 1,
    })
    const video: VideoItem = {
      id: 'motion-video',
      type: 'video',
      trackId: videoTrack.id,
      from: 0,
      durationInFrames: 120,
      label: 'Interview.mp4',
      src: 'blob:interview-video',
      mediaId: 'interview-media',
      linkedGroupId: 'motion-av-1',
    }
    const audio: AudioItem = {
      id: 'motion-audio',
      type: 'audio',
      trackId: audioTrack.id,
      from: 0,
      durationInFrames: 120,
      label: 'Interview.mp4',
      src: 'blob:interview-audio',
      mediaId: 'interview-media',
      linkedGroupId: 'motion-av-1',
    }
    useItemsStore.getState().setTracks([videoTrack, audioTrack])
    useItemsStore.getState().setItems([video, audio])

    render(<CompositingTimeline />)

    expect(screen.getByTestId(`motion-layer-row-${video.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`motion-layer-row-${audio.id}`)).not.toBeInTheDocument()

    useEditorStore.setState({ linkedSelectionEnabled: false })
    act(() => trimItemEnd(video.id, -10, { forceLinked: true }))
    expect(useItemsStore.getState().itemById[video.id]?.durationInFrames).toBe(110)
    expect(useItemsStore.getState().itemById[audio.id]?.durationInFrames).toBe(110)
  })

  it('toggles Position between coupled and separated dimensions through history', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    openTransformOptions()
    const separateDimensions = screen.getByRole('menuitemcheckbox', {
      name: 'Separate Position dimensions',
    })
    expect(separateDimensions).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(separateDimensions)

    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.separatedVectorProperties,
    ).toEqual(['position'])
    expect(screen.getByText('X Position')).toBeInTheDocument()
    expect(screen.getByText('Y Position')).toBeInTheDocument()
    openTransformOptions()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Separate Position dimensions' }),
    ).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })

    act(() => useTimelineCommandStore.getState().undo())

    expect(useKeyframesStore.getState().keyframesByItemId[shape.id]).toBeUndefined()
    expect(screen.getByText('Position')).toBeInTheDocument()
    expect(screen.queryByText('X Position')).not.toBeInTheDocument()
  })

  it('combines matching legacy X/Y keys into one Position lane', () => {
    useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 0, 100)
    useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 30, 200)
    useKeyframesStore.getState()._addKeyframe(shape.id, 'y', 0, 80)
    useKeyframesStore.getState()._addKeyframe(shape.id, 'y', 30, 180)
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    openTransformOptions()
    const separateDimensions = screen.getByRole('menuitemcheckbox', {
      name: 'Separate Position dimensions',
    })
    expect(separateDimensions).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(separateDimensions)

    const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[shape.id]
    expect(itemKeyframes?.properties.some((property) => property.property === 'x')).toBe(false)
    expect(itemKeyframes?.properties.some((property) => property.property === 'y')).toBe(false)
    expect(
      itemKeyframes?.vectorProperties?.find((property) => property.property === 'position')
        ?.keyframes,
    ).toEqual([
      expect.objectContaining({ frame: 0, value: { x: 100, y: 80 } }),
      expect.objectContaining({ frame: 30, value: { x: 200, y: 180 } }),
    ])
    expect(screen.getByLabelText('Position X')).toBeInTheDocument()
    expect(screen.queryByText('X Position')).not.toBeInTheDocument()
  })

  it('expands and collapses every layer with Shift-click', () => {
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 1,
    })
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
    }
    useItemsStore.getState().setTracks([track, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])
    render(<CompositingTimeline />)

    const expandButtons = screen.getAllByRole('button', { name: 'Expand layer properties' })
    fireEvent.click(expandButtons[0]!, { shiftKey: true })

    expect(useComposeUiStore.getState().expandedLayerIdsByComposition['comp-1']).toEqual([
      shape.id,
      secondShape.id,
    ])
    expect(screen.getAllByRole('button', { name: 'Collapse layer properties' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse layer properties' })[0]!, {
      shiftKey: true,
    })

    expect(useComposeUiStore.getState().expandedLayerIdsByComposition['comp-1']).toEqual([])
  })

  it('uses a light border and readable text for the selected segment', () => {
    useSelectionStore.getState().selectItems([shape.id])
    render(<CompositingTimeline />)

    expect(screen.getByTestId(`motion-layer-span-${shape.id}`)).toHaveClass(
      'border-foreground/80',
      'text-foreground',
    )
  })

  it('shows generated motion on the parent span and its driven child properties', () => {
    useItemsStore.getState().setItems([
      {
        ...shape,
        from: 15,
        durationInFrames: 60,
        motionModifiers: [
          {
            id: 'drift-1',
            type: 'float-drift',
            enabled: true,
            amplitude: 1,
            frequency: 0.6,
            phaseFrames: 0,
            seed: 1,
          },
        ],
      },
    ])

    render(<CompositingTimeline />)

    expect(screen.getByTestId(`motion-procedural-badge-${shape.id}`)).toHaveTextContent('ƒx')
    expect(screen.queryByTestId(`motion-procedural-summary-${shape.id}`)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    expect(screen.getByTestId('procedural-band-x')).toHaveAttribute('data-from-frame', '15')
    expect(screen.getByTestId('procedural-band-x')).toHaveAttribute('data-to-frame', '74')
    expect(screen.queryByTestId('procedural-band-y')).not.toBeInTheDocument()
    expect(screen.getByTestId('procedural-band-rotation')).toBeInTheDocument()
  })

  it('shows procedural text-motion slots on collapsed and expanded text layers', () => {
    useItemsStore.getState().setItems([
      {
        ...shape,
        type: 'text',
        text: 'New Motion Editor',
        color: '#ffffff',
        from: 18,
        durationInFrames: 69,
        textMotion: {
          in: {
            presetId: 'blur-in',
            durationFrames: 14,
            staggerFrames: 3,
            intensity: 1,
            order: 'forward',
            easing: 'ease-out',
            seed: 0,
            unit: 'word',
          },
          out: {
            presetId: 'sink',
            durationFrames: 14,
            staggerFrames: 4,
            intensity: 1,
            order: 'forward',
            easing: 'ease-in',
            seed: 0,
            unit: 'word',
          },
        },
      } as TimelineItem,
    ])

    render(<CompositingTimeline />)

    expect(screen.getByTestId(`motion-procedural-badge-${shape.id}`)).toHaveTextContent('ƒx')
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    expect(screen.getByTestId('motion-text-procedural-lanes')).toBeInTheDocument()
    expect(screen.getByTestId('motion-text-procedural-band-in')).toHaveAttribute(
      'data-from-frame',
      '18',
    )
    expect(screen.getByTestId('motion-text-procedural-band-out')).toHaveAttribute(
      'data-to-frame',
      '87',
    )

    const inBand = screen.getByTestId('motion-text-procedural-band-in')
    expect(inBand).toHaveClass('h-4')
    expect(inBand.parentElement?.parentElement).toHaveClass('h-7')
    useSelectionStore.getState().clearSelection()
    useEditorStore.getState().setRightSidebarOpen(false)
    useEditorStore.getState().setClipInspectorTab('video')
    fireEvent.click(inBand)
    expect(useSelectionStore.getState().selectedItemIds).toEqual([shape.id])
    expect(useEditorStore.getState().rightSidebarOpen).toBe(true)
    expect(useEditorStore.getState().clipInspectorTab).toBe('audio')

    vi.spyOn(inBand.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 24,
      width: 300,
      height: 24,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(inBand, { pointerId: 21, button: 0, clientX: 100 })
    fireEvent.pointerMove(inBand, { pointerId: 21, buttons: 1, clientX: 130 })

    expect(inBand).toHaveAttribute(
      'title',
      expect.stringContaining('drag to change duration · 26f'),
    )
    const duringDrag = useItemsStore.getState().itemById[shape.id]
    expect(duringDrag?.type === 'text' ? duringDrag.textMotion?.in?.durationFrames : null).toBe(14)

    fireEvent.pointerCancel(inBand, { pointerId: 21, clientX: 130 })

    expect(inBand).toHaveAttribute('title', expect.stringContaining('14f'))
    const afterCancel = useItemsStore.getState().itemById[shape.id]
    expect(afterCancel?.type === 'text' ? afterCancel.textMotion?.in?.durationFrames : null).toBe(
      14,
    )
    expect(useTimelineCommandStore.getState().undoStack).toHaveLength(0)

    fireEvent.pointerDown(inBand, { pointerId: 22, button: 0, clientX: 100 })
    fireEvent.pointerMove(inBand, { pointerId: 22, buttons: 1, clientX: 130 })

    fireEvent.pointerUp(inBand, { pointerId: 22, clientX: 130 })

    const updated = useItemsStore.getState().itemById[shape.id]
    expect(updated?.type === 'text' ? updated.textMotion?.in?.durationFrames : null).toBe(26)
  })

  it('uses one shared flag-and-line playhead and supports continuous ruler scrubbing', () => {
    render(<CompositingTimeline />)
    const playhead = screen.getByTestId('motion-playhead')
    expect(screen.getAllByTestId('motion-playhead')).toHaveLength(1)
    expect(playhead.querySelectorAll('span')).toHaveLength(2)
    expect(playhead.querySelector('[data-playhead-mark="handle"]')).not.toHaveClass('sticky')
    expect(playhead.parentElement).toHaveStyle({ left: '630px', right: '9px' })
    expect(playhead.parentElement).toHaveClass('overflow-visible')
    expect(playhead.parentElement).toHaveClass('inset-y-0')
    expect(playhead.parentElement).not.toHaveClass('h-[100vh]')
    expect(playhead.parentElement?.parentElement).toHaveClass('absolute', 'inset-0')
    expect(playhead.parentElement?.parentElement?.parentElement).toHaveClass(
      'relative',
      'min-h-0',
      'flex-1',
    )
    expect(screen.getByTestId(`motion-layer-span-${shape.id}`).parentElement).toHaveClass(
      'overflow-hidden',
    )

    const ruler = screen.getByText('0.0s').parentElement!.parentElement!
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 28,
      width: 300,
      height: 28,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(ruler, { pointerId: 1, button: 0, clientX: 0 })
    fireEvent.pointerMove(ruler, { pointerId: 1, buttons: 1, clientX: 150 })
    fireEvent.pointerUp(ruler, { pointerId: 1, clientX: 150 })

    expect(usePlaybackStore.getState().currentFrame).toBe(60)
  })

  it('batches ruler scrub movement to the latest pointer position per animation frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    const ruler = screen.getByText('0.0s').parentElement!.parentElement!
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 28,
      width: 300,
      height: 28,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(ruler, { pointerId: 2, button: 0, clientX: 0 })
    fireEvent.pointerMove(ruler, { pointerId: 2, buttons: 1, clientX: 75 })
    fireEvent.pointerMove(ruler, { pointerId: 2, buttons: 1, clientX: 150 })

    expect(frameCallbacks).toHaveLength(1)
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(usePlaybackStore.getState().currentFrame).toBe(0)
    expect(usePlaybackStore.getState().previewFrame).toBe(60)

    fireEvent.pointerUp(ruler, { pointerId: 2, clientX: 150 })
    expect(usePlaybackStore.getState().currentFrame).toBe(60)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    animationFrameSpy.mockRestore()
  })

  it('auto-pans the zoomed Motion viewport while the playhead is held near an edge', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const settleCallbacks: Array<() => void> = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay) => {
      if (delay === 100 && typeof callback === 'function') settleCallbacks.push(callback)
      return settleCallbacks.length as unknown as ReturnType<typeof window.setTimeout>
    })
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(300)

    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')

    fireEvent.wheel(scrollArea, { ctrlKey: true, clientX: 750, deltaY: -100 })
    act(() => settleCallbacks[0]?.())
    expect(navigator).toHaveAttribute('data-start-frame', '8')
    expect(navigator).toHaveAttribute('data-end-frame', '104')
    frameCallbacks.length = 0
    timeoutSpy.mockRestore()

    const ruler = document.querySelector<HTMLElement>('[data-motion-ruler-surface]')!
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 28,
      width: 300,
      height: 28,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(ruler, { pointerId: 4, button: 0, clientX: 300 })
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(16))
    const firstAutoPanStart = Number(navigator.dataset.startFrame)
    const playhead = screen.getByTestId('motion-playhead')
    expect(firstAutoPanStart).toBeGreaterThan(8)
    expect(playhead).not.toHaveAttribute('hidden')
    expect(playhead).toHaveStyle({ transform: 'translate3d(299px, 0, 0)' })
    expect(frameCallbacks).toHaveLength(1)

    act(() => frameCallbacks.shift()?.(32))
    expect(Number(navigator.dataset.startFrame)).toBeGreaterThan(firstAutoPanStart)
    expect(playhead).not.toHaveAttribute('hidden')
    expect(playhead).toHaveStyle({ transform: 'translate3d(299px, 0, 0)' })
    expect(frameCallbacks).toHaveLength(1)

    fireEvent.pointerUp(ruler, { pointerId: 4, clientX: 300 })
    expect(Number(navigator.dataset.startFrame)).toBeGreaterThan(8)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    clientWidthSpy.mockRestore()
    animationFrameSpy.mockRestore()
  })

  it('keeps expanded property editors render-idle until a scrub settles', () => {
    useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 0, 100)
    useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 60, 300)
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    const input = screen.getByRole('spinbutton', { name: 'X Position value at playhead' })
    const ruler = screen.getByText('0.0s').parentElement!.parentElement!
    vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 28,
      width: 300,
      height: 28,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(ruler, { pointerId: 3, button: 0, clientX: 0 })
    fireEvent.pointerMove(ruler, { pointerId: 3, buttons: 1, clientX: 150 })
    act(() => frameCallbacks.shift()?.(performance.now()))

    expect(usePlaybackStore.getState().previewFrame).toBe(60)
    expect(input).toHaveValue(100)

    fireEvent.pointerUp(ruler, { pointerId: 3, clientX: 150 })
    expect(input).toHaveValue(300)
    animationFrameSpy.mockRestore()
  })

  it('keeps ctrl-wheel zoom while leaving ordinary wheel input to vertical scrolling', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })

    expect(screen.getByTestId('motion-time-navigator')).toHaveAttribute('data-start-frame', '0')
    expect(screen.getByTestId('motion-time-navigator')).toHaveAttribute('data-end-frame', '120')
    const firstRulerTick = screen.getByText('0.0s').parentElement!
    const firstRulerTickLeft = firstRulerTick.style.left
    const staticGridTicks = Array.from(
      document.querySelectorAll<HTMLElement>('[data-motion-static-x]'),
    )
    const staticGridTickPositions = staticGridTicks.map((tick) => tick.style.left)
    const dynamicGrids = Array.from(
      document.querySelectorAll<HTMLElement>('[data-motion-grid-frames]'),
    )
    expect(staticGridTicks.length).toBeGreaterThan(0)
    expect(dynamicGrids.length).toBeGreaterThan(0)
    expect(
      dynamicGrids.every(
        (grid) =>
          grid.closest<HTMLElement>('[data-motion-viewport-surface]')?.dataset
            .motionViewportEdgeInset === '9' &&
          Number(
            grid.closest<HTMLElement>('[data-motion-viewport-surface]')?.dataset
              .motionViewportAxisWidth,
          ) > 0,
      ),
    ).toBe(true)
    expect(screen.getByText('4.0s')).toBeInTheDocument()

    fireEvent.wheel(scrollArea, { ctrlKey: true, clientX: 750, deltaY: -100 })
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))

    expect(screen.getByText('0.3s')).toBeInTheDocument()
    expect(screen.getByText('3.5s')).toBeInTheDocument()
    expect(screen.queryByText('4.0s')).not.toBeInTheDocument()
    expect(screen.getByText('0.3s').parentElement).toBe(firstRulerTick)
    expect(firstRulerTick.style.left).toBe(firstRulerTickLeft)
    expect(staticGridTicks.map((tick) => tick.style.left)).toEqual(staticGridTickPositions)

    const panEvent = createEvent.wheel(scrollArea, {
      clientX: 750,
      deltaY: 100,
      cancelable: true,
    })
    fireEvent(scrollArea, panEvent)

    expect(panEvent.defaultPrevented).toBe(false)
    expect(screen.getByText('0.3s')).toBeInTheDocument()
    expect(screen.getByText('3.5s')).toBeInTheDocument()
    expect(scrollArea).toHaveClass('overflow-y-auto')
    animationFrameSpy.mockRestore()
  })

  it('flushes the final wheel geometry when settle wins before the queued animation frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const settleCallbacks: Array<() => void> = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })

    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')
    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation((callback, delay) => {
      if (delay === 100 && typeof callback === 'function') {
        settleCallbacks.push(callback)
      }
      return settleCallbacks.length as unknown as ReturnType<typeof window.setTimeout>
    })

    fireEvent.wheel(scrollArea, { ctrlKey: true, clientX: 750, deltaY: -100 })

    expect(frameCallbacks).toHaveLength(1)
    expect(settleCallbacks).toHaveLength(1)
    expect(navigator).toHaveAttribute('data-start-frame', '0')
    settleCallbacks[0]?.()
    expect(navigator).toHaveAttribute('data-start-frame', '8')
    expect(navigator).toHaveAttribute('data-end-frame', '104')

    timeoutSpy.mockRestore()
    animationFrameSpy.mockRestore()
  })

  it('keeps the final ruler preview when navigator resize commits', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(1000)

    render(<CompositingTimeline />)
    const navigator = screen.getByTestId('motion-time-navigator')
    const rulerSurface = screen.getByText('0.0s').parentElement!.parentElement!
    const originalTicks = Array.from(rulerSurface.children)
    const originalTickPositions = originalTicks.map((tick) => (tick as HTMLElement).style.left)

    fireEvent.mouseDown(screen.getByTestId('keyframe-navigator-right-handle'), {
      clientX: 1000,
    })
    fireEvent.mouseMove(window, { clientX: 800 })
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))

    const previewEndFrame = navigator.dataset.endFrame
    const previewLabels = Array.from(
      rulerSurface.querySelectorAll<HTMLElement>('[data-motion-ruler-label-index]'),
      (label) => label.textContent,
    )
    expect(previewEndFrame).not.toBe('120')

    fireEvent.mouseUp(window)

    expect(navigator).toHaveAttribute('data-end-frame', previewEndFrame)
    expect(
      Array.from(
        rulerSurface.querySelectorAll<HTMLElement>('[data-motion-ruler-label-index]'),
        (label) => label.textContent,
      ),
    ).toEqual(previewLabels)
    expect(Array.from(rulerSurface.children)).toEqual(originalTicks)
    expect(Array.from(rulerSurface.children, (tick) => (tick as HTMLElement).style.left)).toEqual(
      originalTickPositions,
    )

    clientWidthSpy.mockRestore()
    animationFrameSpy.mockRestore()
  })

  it('does not pan the time viewport for ordinary mixed-axis wheel input', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')

    fireEvent.wheel(scrollArea, { ctrlKey: true, clientX: 750, deltaY: -100 })
    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(navigator).toHaveAttribute('data-start-frame', '8')
    expect(navigator).toHaveAttribute('data-end-frame', '104')

    const wheelEvent = createEvent.wheel(scrollArea, {
      clientX: 750,
      deltaX: -1,
      deltaY: 25,
      cancelable: true,
    })
    fireEvent(scrollArea, wheelEvent)

    expect(wheelEvent.defaultPrevented).toBe(false)
    expect(navigator).toHaveAttribute('data-start-frame', '8')
    expect(navigator).toHaveAttribute('data-end-frame', '104')
    animationFrameSpy.mockRestore()
  })

  it('accumulates shift-wheel panning while previewing its frame-aligned settled position', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')

    fireEvent.wheel(scrollArea, { ctrlKey: true, clientX: 750, deltaY: -100 })
    const firstPan = createEvent.wheel(scrollArea, {
      shiftKey: true,
      clientX: 750,
      deltaX: -1,
      deltaY: 1,
      cancelable: true,
    })
    fireEvent(scrollArea, firstPan)
    fireEvent.wheel(scrollArea, { shiftKey: true, clientX: 750, deltaX: -1, deltaY: 1 })

    expect(firstPan.defaultPrevented).toBe(true)
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(navigator).toHaveAttribute('data-start-frame', '9')
    expect(navigator).toHaveAttribute('data-end-frame', '105')

    fireEvent.wheel(scrollArea, { shiftKey: true, clientX: 750, deltaX: -100, deltaY: 10 })
    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(navigator).toHaveAttribute('data-start-frame', '11')
    expect(navigator).toHaveAttribute('data-end-frame', '107')
    animationFrameSpy.mockRestore()
  })

  it('coalesces dominant horizontal trackpad input into one viewport update per frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')

    fireEvent.wheel(scrollArea, { ctrlKey: true, clientX: 750, deltaY: -100 })
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(navigator).toHaveAttribute('data-start-frame', '8')
    expect(navigator).toHaveAttribute('data-end-frame', '104')

    const horizontalEvents = Array.from({ length: 4 }, () =>
      createEvent.wheel(scrollArea, {
        clientX: 750,
        deltaX: 10,
        deltaY: 1,
        cancelable: true,
      }),
    )
    for (const event of horizontalEvents) fireEvent(scrollArea, event)

    expect(horizontalEvents.every((event) => event.defaultPrevented)).toBe(true)
    expect(frameCallbacks).toHaveLength(1)
    expect(navigator).toHaveAttribute('data-start-frame', '8')

    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(navigator).toHaveAttribute('data-start-frame', '18')
    expect(navigator).toHaveAttribute('data-end-frame', '114')
    animationFrameSpy.mockRestore()
  })

  it('accumulates rapid mouse-wheel zoom around the cursor without treating horizontal input as zoom', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')

    act(() => {
      scrollArea.dispatchEvent(
        createEvent.wheel(scrollArea, {
          ctrlKey: true,
          clientX: 750,
          deltaY: -100,
          cancelable: true,
        }),
      )
      scrollArea.dispatchEvent(
        createEvent.wheel(scrollArea, {
          ctrlKey: true,
          clientX: 750,
          deltaY: -100,
          cancelable: true,
        }),
      )
    })

    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(performance.now()))
    expect(navigator).toHaveAttribute('data-start-frame', '15')
    expect(navigator).toHaveAttribute('data-end-frame', '92')

    const horizontalEvent = createEvent.wheel(scrollArea, {
      ctrlKey: true,
      clientX: 750,
      deltaX: 100,
      deltaY: 0,
      cancelable: true,
    })
    fireEvent(scrollArea, horizontalEvent)

    expect(horizontalEvent.defaultPrevented).toBe(true)
    expect(navigator).toHaveAttribute('data-start-frame', '15')
    expect(navigator).toHaveAttribute('data-end-frame', '92')
    animationFrameSpy.mockRestore()
  })

  it('handles ctrl-wheel zoom after the app-level browser zoom guard prevents the event', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    const navigator = screen.getByTestId('motion-time-navigator')
    const guardedEvent = createEvent.wheel(scrollArea, {
      ctrlKey: true,
      clientX: 750,
      deltaY: -100,
      cancelable: true,
    })

    // App.tsx prevents native browser zoom during document capture before the
    // Motion timeline receives this same event.
    guardedEvent.preventDefault()
    fireEvent(scrollArea, guardedEvent)
    act(() => frameCallbacks.shift()?.(performance.now()))

    expect(guardedEvent.defaultPrevented).toBe(true)
    expect(navigator).toHaveAttribute('data-start-frame', '8')
    expect(navigator).toHaveAttribute('data-end-frame', '104')
    animationFrameSpy.mockRestore()
  })

  it('uses middle-mouse drag to move the layer list vertically without changing selection', () => {
    render(<CompositingTimeline />)
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 400,
      width: 1000,
      height: 400,
      toJSON: () => ({}),
    })
    useSelectionStore.getState().clearSelection()
    scrollArea.scrollTop = 100

    const span = screen.getByTestId(`motion-layer-span-${shape.id}`)
    fireEvent.pointerDown(span, { button: 1, buttons: 4, pointerId: 7, clientX: 800, clientY: 200 })
    fireEvent.pointerMove(window, { buttons: 4, pointerId: 7, clientX: 700, clientY: 300 })

    expect(useSelectionStore.getState().selectedItemIds).toEqual([])
    expect(useKeyframeSelectionStore.getState().selectedKeyframes).toEqual([])
    expect(scrollArea.scrollTop).toBe(200)
    expect(screen.getByText('0.0s')).toBeInTheDocument()
    expect(screen.getByText('4.0s')).toBeInTheDocument()

    fireEvent.pointerUp(window, { button: 1, pointerId: 7, clientX: 700, clientY: 300 })
    expect(document.body.style.cursor).toBe('')
  })

  it('adds an undoable property keyframe at the shared playhead', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    fireEvent.click(screen.getByRole('button', { name: /toggle position keyframe at playhead/i }))

    const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[shape.id]
    expect(itemKeyframes?.properties).toEqual([])
    expect(itemKeyframes?.vectorProperties?.[0]?.keyframes).toEqual([
      expect.objectContaining({ frame: 0, value: { x: 100, y: 80 } }),
    ])

    useTimelineCommandStore.getState().undo()
    expect(useKeyframesStore.getState().keyframesByItemId[shape.id]).toBeUndefined()
  })

  it('authors linked Scale axes together and can explicitly unlink them', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const scaleX = screen.getByLabelText('Scale X')
    fireEvent.change(scaleX, { target: { value: '125' } })
    fireEvent.keyDown(scaleX, { key: 'Enter' })

    expect(
      useKeyframesStore
        .getState()
        .keyframesByItemId[shape.id]?.vectorProperties?.find((lane) => lane.property === 'scale')
        ?.keyframes[0]?.value,
    ).toEqual({ x: 125, y: 125 })

    fireEvent.click(screen.getByRole('button', { name: 'Unlink Scale axes' }))
    expect(useItemsStore.getState().itemById[shape.id]?.transform?.aspectRatioLocked).toBe(false)
  })

  it('shows one ruler range and batch-retimes selected keyframes across layers', () => {
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 1,
    })
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
    }
    useItemsStore.getState().setTracks([track, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])
    const firstId = useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 10, 100)
    const secondId = useKeyframesStore.getState()._addKeyframe(secondShape.id, 'x', 80, 300)
    useKeyframeSelectionStore.getState().selectKeyframes([
      { itemId: shape.id, property: 'x', keyframeId: firstId },
      { itemId: secondShape.id, property: 'x', keyframeId: secondId },
    ])
    let previewFrame: FrameRequestCallback | null = null
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        previewFrame = callback
        return 1
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {})

    render(<CompositingTimeline />)

    const range = screen.getByTestId('motion-selection-retime-range')
    expect(screen.getByTestId('motion-ruler-viewport')).toHaveClass(
      'overflow-x-clip',
      'overflow-y-visible',
    )
    expect(screen.getByTestId('motion-ruler-viewport')).not.toHaveClass('overflow-hidden')
    expect(range).toHaveAttribute('title', expect.stringContaining('across 2 layers'))
    const startHandle = screen.getByRole('slider', { name: 'Retime selected keyframes start' })
    vi.spyOn(range.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 28,
      width: 1000,
      height: 28,
      toJSON: () => ({}),
    })

    const initialRangeLeft = range.style.left
    fireEvent.pointerDown(startHandle, { pointerId: 9, clientX: 100 })
    fireEvent.pointerMove(startHandle, { pointerId: 9, clientX: 200 })

    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(10)
    act(() => previewFrame?.(16))
    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(10)
    expect(range.style.left).not.toBe(initialRangeLeft)

    fireEvent.pointerUp(startHandle, { pointerId: 9, clientX: 200 })

    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(22)
    expect(
      useKeyframesStore.getState().keyframesByItemId[secondShape.id]?.properties[0]?.keyframes[0]
        ?.frame,
    ).toBe(80)

    useTimelineCommandStore.getState().undo()
    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(10)
    expect(
      useKeyframesStore.getState().keyframesByItemId[secondShape.id]?.properties[0]?.keyframes[0]
        ?.frame,
    ).toBe(80)

    const restoredRangeLeft = range.style.left
    fireEvent.pointerDown(startHandle, { pointerId: 10, clientX: 100 })
    fireEvent.pointerMove(startHandle, { pointerId: 10, clientX: 150 })
    act(() => previewFrame?.(32))
    expect(range.style.left).not.toBe(restoredRangeLeft)
    fireEvent.pointerCancel(startHandle, { pointerId: 10, clientX: 150 })
    expect(range.style.left).toBe(restoredRangeLeft)
    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(10)

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Retime selected keyframes end' }), {
      key: 'ArrowRight',
    })
    expect(
      useKeyframesStore.getState().keyframesByItemId[secondShape.id]?.properties[0]?.keyframes[0]
        ?.frame,
    ).toBe(81)
    useTimelineCommandStore.getState().undo()
    expect(
      useKeyframesStore.getState().keyframesByItemId[secondShape.id]?.properties[0]?.keyframes[0]
        ?.frame,
    ).toBe(80)

    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('previews connector geometry while ruler handles retime selected keyframes', () => {
    const firstId = useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 10, 100)
    const secondId = useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 80, 300)
    useKeyframeSelectionStore.getState().selectKeyframes([
      { itemId: shape.id, property: 'x', keyframeId: firstId },
      { itemId: shape.id, property: 'x', keyframeId: secondId },
    ])
    let previewFrame: FrameRequestCallback | null = null
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        previewFrame = callback
        return 1
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {})

    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const connector = screen.getByTestId('keyframe-connector')
    expect(connector).toHaveAttribute('data-motion-connector-from-keyframe-id', firstId)
    expect(connector).toHaveAttribute('data-motion-connector-to-keyframe-id', secondId)
    const initialLeft = connector.style.left
    const initialWidth = connector.style.width
    const range = screen.getByTestId('motion-selection-retime-range')
    vi.spyOn(range.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 28,
      width: 1000,
      height: 28,
      toJSON: () => ({}),
    })
    const startHandle = screen.getByRole('slider', { name: 'Retime selected keyframes start' })

    fireEvent.pointerDown(startHandle, { pointerId: 11, clientX: 100 })
    fireEvent.pointerMove(startHandle, { pointerId: 11, clientX: 200 })
    act(() => previewFrame?.(16))

    expect(connector.style.left).not.toBe(initialLeft)
    expect(connector.style.width).not.toBe(initialWidth)
    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(10)

    fireEvent.pointerCancel(startHandle, { pointerId: 11, clientX: 200 })
    expect(connector.style.left).toBe(initialLeft)
    expect(connector.style.width).toBe(initialWidth)

    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('shows Transform as a collapsible sibling property group', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const layerRow = screen.getByTestId(`motion-layer-row-${shape.id}`)
    const editor = within(layerRow).getByTestId('dopesheet-editor-root')
    const expandedHeight = Number.parseFloat(editor.style.height)
    const transformHeader = screen.getByRole('button', { name: /collapse transform/i })
    expect(transformHeader).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /collapse shape/i })).toBeInTheDocument()

    fireEvent.click(transformHeader)
    expect(screen.queryByRole('spinbutton', { name: /x position value at playhead/i })).toBeNull()
    expect(screen.getByRole('button', { name: /collapse shape/i })).toBeInTheDocument()
    expect(Number.parseFloat(editor.style.height)).toBeLessThan(expandedHeight)

    fireEvent.click(screen.getByRole('button', { name: /expand transform/i }))
    expect(Number.parseFloat(editor.style.height)).toBe(expandedHeight)
  })

  it('does not create a Vector2 keyframe when a changed axis is blurred', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const input = screen.getByLabelText('Position X')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '140' } })
    fireEvent.blur(input)

    expect(useKeyframesStore.getState().keyframesByItemId[shape.id]).toBeUndefined()
    expect(input).toHaveValue('100.00')
  })

  it('previews Motion Position scrubs once per animation frame and commits on release', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const input = screen.getByLabelText('Position X')
    fireEvent.pointerDown(input, { button: 0, pointerId: 17, clientX: 100 })
    fireEvent.pointerMove(input, { pointerId: 17, clientX: 150 })
    fireEvent.pointerMove(input, { pointerId: 17, clientX: 200 })

    expect(useGizmoStore.getState().preview?.[shape.id]).toBeUndefined()
    expect(useKeyframesStore.getState().keyframesByItemId[shape.id]).toBeUndefined()
    expect(frameCallbacks).toHaveLength(1)

    act(() => frameCallbacks[0]?.(16))
    expect(useGizmoStore.getState().preview?.[shape.id]?.transform).toMatchObject({
      x: 101,
      y: 80,
    })
    expect(useKeyframesStore.getState().keyframesByItemId[shape.id]).toBeUndefined()

    fireEvent.pointerUp(input, { pointerId: 17, clientX: 200 })
    expect(useGizmoStore.getState().preview?.[shape.id]).toBeUndefined()
    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.vectorProperties?.[0]
        ?.keyframes[0]?.value,
    ).toEqual({ x: 101, y: 80 })

    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('mirrors a canvas gizmo drag into Motion Position before release once per frame', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const input = screen.getByLabelText('Position X')
    expect(input).toHaveValue('100.00')
    perfMarkMocks.mark.mockClear()

    let interactionId = 0
    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      interactionId = gizmo.startTranslate(
        shape.id,
        { x: 0, y: 0 },
        {
          x: 100,
          y: 80,
          width: 400,
          height: 220,
          rotation: 0,
          opacity: 1,
        },
      )
      gizmo.updateInteraction({ x: 20, y: 0 }, false)
      gizmo.updateInteraction({ x: 60, y: 0 }, false)
    })

    expect(input).toHaveValue('100.00')
    expect(useItemsStore.getState().itemById[shape.id]?.transform?.x).toBe(100)
    expect(frameCallbacks).toHaveLength(1)

    act(() => frameCallbacks[0]?.(16))
    expect(input).toHaveValue('160.00')
    expect(useItemsStore.getState().itemById[shape.id]?.transform?.x).toBe(100)
    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('DopesheetEditor')

    act(() => useGizmoStore.getState().clearInteraction(interactionId))
    act(() => frameCallbacks[1]?.(32))
    expect(input).toHaveValue('160.00')
    expect(useGizmoStore.getState().presentationHandoff?.finalTransform.x).toBe(160)
    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('DopesheetEditor')

    act(() => useGizmoStore.getState().cancelInteraction())
    act(() => frameCallbacks[2]?.(48))
    expect(input).toHaveValue('100.00')
    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('DopesheetEditor')

    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('converts a parented gizmo world preview back to the child Position inputs', () => {
    const parentTrack = makeTimelineTrack({
      id: 'parent-track',
      name: 'Parent',
      kind: 'video',
      order: 1,
    })
    const parent: ControllerItem = {
      id: 'parent-1',
      type: 'controller',
      controllerKind: 'null',
      trackId: parentTrack.id,
      from: 0,
      durationInFrames: 120,
      label: 'Parent',
      transform: { x: 50, y: 0, width: 100, height: 100, rotation: 0 },
    }
    const child: ShapeItem = {
      ...shape,
      transformParent: {
        parentItemId: parent.id,
        parentReference: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
        childLocalReference: { x: 100, y: 80, width: 400, height: 220, rotation: 0 },
        childWorldReference: { x: 100, y: 80, width: 400, height: 220, rotation: 0 },
      },
    }
    useItemsStore.getState().setTracks([track, parentTrack])
    useItemsStore.getState().setItems([child, parent])

    const frameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    render(<CompositingTimeline />)
    const childRow = screen.getByTestId(`motion-layer-row-${child.id}`)
    fireEvent.click(within(childRow).getByRole('button', { name: 'Expand layer properties' }))

    const input = within(childRow).getByLabelText('Position X')
    expect(input).toHaveValue('100.00')
    perfMarkMocks.mark.mockClear()

    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      gizmo.startTranslate(
        child.id,
        { x: 0, y: 0 },
        {
          x: 150,
          y: 80,
          width: 400,
          height: 220,
          rotation: 0,
          opacity: 1,
        },
      )
      gizmo.updateInteraction({ x: 20, y: 0 }, false)
    })
    act(() => frameCallbacks[0]?.(16))

    expect(input).toHaveValue('120.00')
    expect(perfMarkMocks.mark).not.toHaveBeenCalledWith('DopesheetEditor')

    act(() => useGizmoStore.getState().cancelInteraction())
    act(() => frameCallbacks[1]?.(32))
    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('keeps expanded property editors off the playback-frame render path', () => {
    useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 0, 100)
    useKeyframesStore.getState()._addKeyframe(shape.id, 'x', 60, 300)
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))

    const input = screen.getByRole('spinbutton', { name: 'X Position value at playhead' })
    expect(input).toHaveValue(100)

    act(() => {
      usePlaybackStore.getState().play()
      usePlaybackStore.getState().setCurrentFrame(60)
    })
    expect(input).toHaveValue(100)

    act(() => usePlaybackStore.getState().pause())
    expect(input).toHaveValue(300)
  })

  it('edits a selected keyframe before creating one at the playhead', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    fireEvent.click(screen.getByRole('button', { name: /toggle position keyframe at playhead/i }))

    const firstKeyframe =
      useKeyframesStore.getState().keyframesByItemId[shape.id]!.vectorProperties![0]!.keyframes[0]!
    useKeyframesStore.getState()._upsertVectorKeyframe(shape.id, 'position', {
      frame: 60,
      value: { x: 300, y: 180 },
      easing: 'linear',
    })
    useKeyframeSelectionStore
      .getState()
      .selectKeyframes([{ itemId: shape.id, property: 'x', keyframeId: firstKeyframe.id }])
    act(() => usePlaybackStore.getState().setCurrentFrame(60))

    let input = screen.getByLabelText('Position X')
    expect(input).toHaveValue('100.00')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '180' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    let keyframes =
      useKeyframesStore.getState().keyframesByItemId[shape.id]!.vectorProperties![0]!.keyframes
    expect(keyframes).toEqual([
      expect.objectContaining({ frame: 0, value: { x: 180, y: 80 } }),
      expect.objectContaining({ frame: 60, value: { x: 300, y: 180 } }),
    ])

    useKeyframeSelectionStore.getState().clearSelection()
    act(() => usePlaybackStore.getState().setCurrentFrame(90))
    input = screen.getByLabelText('Position X')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '220' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    keyframes =
      useKeyframesStore.getState().keyframesByItemId[shape.id]!.vectorProperties![0]!.keyframes
    expect(keyframes).toEqual([
      expect.objectContaining({ frame: 0, value: { x: 180, y: 80 } }),
      expect.objectContaining({ frame: 60, value: { x: 300, y: 180 } }),
      expect.objectContaining({ frame: 90, value: expect.objectContaining({ x: 220 }) }),
    ])
  })

  it('deletes selected diamonds without deleting the selected layer', async () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    fireEvent.click(screen.getByRole('button', { name: /toggle position keyframe at playhead/i }))

    const keyframe =
      useKeyframesStore.getState().keyframesByItemId[shape.id]!.vectorProperties![0]!.keyframes[0]!
    useKeyframeSelectionStore
      .getState()
      .selectKeyframes([{ itemId: shape.id, property: 'x', keyframeId: keyframe.id }])

    const marker = await screen.findByTestId(`row-keyframe-x-${keyframe.id}`)
    fireEvent.pointerEnter(marker)
    expect(useEditorStore.getState().keyframeEditorShortcutScopeActive).toBe(true)
    fireEvent.keyDown(marker, { key: 'Delete' })

    await waitFor(() => {
      expect(
        useKeyframesStore.getState().keyframesByItemId[shape.id]?.vectorProperties?.[0]
          ?.keyframes ?? [],
      ).toHaveLength(0)
    })
    expect(useItemsStore.getState().itemById[shape.id]).toBeDefined()
  })

  it('switches the whole right timeline pane to the selected property graph', () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    expect(screen.getByTestId(`motion-layer-span-${shape.id}`)).toBeInTheDocument()

    const rowBefore = screen.getByText('Position').closest('.group')
    expect(rowBefore).toHaveClass('pl-6')
    expect(screen.getByTestId('motion-layer-scroll-area')).toHaveClass(
      'overflow-x-hidden',
      'overflow-y-auto',
    )
    expect(screen.getAllByTestId('compound-property-inputs')[0]).toHaveClass('w-[192px]')

    const curveButton = screen.getByRole('button', { name: /show position curve/i })
    expect(curveButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(curveButton)

    expect(screen.getByTestId('dopesheet-graph-pane')).toBeInTheDocument()
    expect(screen.getByTestId('motion-graph-pane')).toHaveStyle({
      left: '621px',
      top: '28px',
    })
    expect(screen.getByTestId('motion-graph-pane')).toHaveClass('bottom-0', 'right-0')
    expect(screen.queryByTestId(`motion-layer-span-${shape.id}`)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show position curve/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByText('Motion curves')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /sheet/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /graph/i })).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('motion-graph-pane')).queryByRole('button', {
        name: /collapse transform/i,
      }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show position curve/i }))
    expect(screen.queryByTestId('dopesheet-graph-pane')).not.toBeInTheDocument()
    expect(screen.queryByTestId('motion-graph-pane')).not.toBeInTheDocument()
    expect(screen.getByTestId(`motion-layer-span-${shape.id}`)).toBeInTheDocument()
  })

  it('filters expanded rows to animated properties and exposes classic segment easing', async () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    fireEvent.click(screen.getByRole('button', { name: /toggle position keyframe at playhead/i }))
    act(() => usePlaybackStore.getState().setCurrentFrame(60))
    fireEvent.click(
      await screen.findByRole('button', { name: /toggle position keyframe at playhead/i }),
    )

    const easingTriggers = await screen.findAllByRole('button', { name: 'Easing' })
    expect(easingTriggers.length).toBeGreaterThan(0)
    fireEvent.click(easingTriggers[0]!)
    expect(await screen.findByText('Cubic Easing')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('combobox', { name: 'Property filter' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Animated properties' }))
    expect(screen.getByText('Position')).toBeInTheDocument()
    expect(screen.queryByText('Y Position')).not.toBeInTheDocument()
  }, 10_000)

  it('hides the expanded child area when no properties are animated', async () => {
    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand layer properties' }))
    expect(screen.getByText('Position')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('combobox', { name: 'Property filter' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Animated properties' }))

    expect(screen.queryByText('Position')).not.toBeInTheDocument()
    expect(screen.queryByText('No parameters match the current view')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Collapse layer properties' }),
    ).not.toBeInTheDocument()
  })

  it('exposes layer actions in the context menu and renames inline', async () => {
    render(<CompositingTimeline />)
    const layerName = screen.getByRole('button', { name: /1hero rectangle/i })
    fireEvent.contextMenu(layerName)
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveAttribute('data-disabled')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.doubleClick(layerName)

    const nameInput = screen.getByRole('textbox', { name: 'Layer name' })
    fireEvent.change(nameInput, { target: { value: 'Renamed rectangle' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    expect(useItemsStore.getState().itemById[shape.id]?.label).toBe('Renamed rectangle')
  })

  it('preserves a multi-selection when grouping from a selected layer context menu', async () => {
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 1,
    })
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
    }
    useItemsStore.getState().setTracks([track, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])
    useSelectionStore.getState().selectItems([shape.id, secondShape.id])
    render(<CompositingTimeline />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /2circle/i }))

    expect(useSelectionStore.getState().selectedItemIds).toEqual([shape.id, secondShape.id])
    fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'Create Layer Group from selected layers',
      }),
    )

    expect(useItemsStore.getState().tracks.filter((candidate) => candidate.isGroup)).toHaveLength(1)
  })

  it('creates a dedicated backing track when adding a generated layer', () => {
    render(<CompositingTimeline />)
    const addItemButton = screen.getByRole('button', { name: 'Add Item' })
    fireEvent.pointerDown(addItemButton, { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Text' }))

    const state = useItemsStore.getState()
    const textLayer = state.items.find((item) => item.type === 'text')
    expect(textLayer).toBeDefined()
    expect(state.tracks.find((candidate) => candidate.id === textLayer?.trackId)?.name).toBe(
      textLayer?.label,
    )
  })

  it('adds a non-rendering Null Object layer for transform parenting', () => {
    render(<CompositingTimeline />)
    const addItemButton = screen.getByRole('button', { name: 'Add Item' })
    fireEvent.pointerDown(addItemButton, { button: 0, ctrlKey: false })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Null Object' }))

    const state = useItemsStore.getState()
    const nullObject = state.items.find((item) => item.type === 'controller')
    expect(nullObject).toMatchObject({
      type: 'controller',
      controllerKind: 'null',
      label: 'Null Object',
    })
    expect(state.tracks.find((candidate) => candidate.id === nullObject?.trackId)?.name).toBe(
      'Null Object',
    )
    expect(screen.getByLabelText('Null Object (does not render)')).toBeInTheDocument()
  })

  it('labels composition and item creation actions in the Motion header', () => {
    render(<CompositingTimeline />)

    expect(screen.getByRole('button', { name: 'New composition' })).toHaveTextContent('New Comp')
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create Layer Group from selected layers' }),
    ).toHaveAttribute(
      'title',
      'Organize layers and move them together. Use Parent for transform inheritance.',
    )
  })

  it('parents and unparents a layer from the Parent dropdown', async () => {
    const nullTrack = makeTimelineTrack({
      id: 'null-track',
      name: 'Null Object',
      kind: 'video',
      order: 1,
    })
    const nullObject: ControllerItem = {
      id: 'null-1',
      type: 'controller',
      controllerKind: 'null',
      trackId: nullTrack.id,
      from: 0,
      durationInFrames: 120,
      label: 'Null Object',
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    }
    useItemsStore.getState().setTracks([track, nullTrack])
    useItemsStore.getState().setItems([shape, nullObject])

    render(<CompositingTimeline />)
    const parentCell = screen.getByTestId(`motion-parent-cell-${shape.id}`)
    const parentSelect = within(parentCell).getByRole('combobox', {
      name: 'Parent for Hero rectangle',
    })

    fireEvent.click(parentSelect)
    fireEvent.click(await screen.findByRole('option', { name: /Null: Null Object/ }))

    expect(useItemsStore.getState().itemById[shape.id]?.transformParent?.parentItemId).toBe(
      nullObject.id,
    )
    expect(parentSelect).toHaveTextContent('Null: Null Object')

    fireEvent.click(parentSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'None' }))

    expect(
      useItemsStore.getState().itemById[shape.id]?.transformParent?.parentItemId,
    ).toBeUndefined()
    expect(parentSelect).toHaveTextContent('None')
  })

  it('parents by dragging the Parent pick whip and detaches with Ctrl-click', async () => {
    const nullTrack = makeTimelineTrack({
      id: 'null-track',
      name: 'Null Object',
      kind: 'video',
      order: 1,
    })
    const nullObject: ControllerItem = {
      id: 'null-1',
      type: 'controller',
      controllerKind: 'null',
      trackId: nullTrack.id,
      from: 0,
      durationInFrames: 120,
      label: 'Null Object',
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    }
    useItemsStore.getState().setTracks([track, nullTrack])
    useItemsStore.getState().setItems([shape, nullObject])
    render(<CompositingTimeline />)

    const parentRow = screen.getByTestId(`motion-layer-row-${nullObject.id}`)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => parentRow),
    })
    const pickWhip = screen.getByRole('button', {
      name: 'Parent pick whip for Hero rectangle',
    })

    fireEvent.pointerDown(pickWhip, { button: 0, pointerId: 41, clientX: 0, clientY: 0 })
    expect(screen.getByTestId('transform-parent-pick-whip')).toBeInTheDocument()
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 32, clientY: 24 })
    await waitFor(() => {
      expect(parentRow).toHaveAttribute('data-transform-parent-link-hover', 'true')
    })
    fireEvent.pointerUp(window, { pointerId: 41, clientX: 32, clientY: 24 })

    expect(useItemsStore.getState().itemById[shape.id]?.transformParent?.parentItemId).toBe(
      nullObject.id,
    )
    expect(screen.queryByTestId('transform-parent-pick-whip')).toBeNull()
    expect(parentRow).not.toHaveAttribute('data-transform-parent-link-hover')

    fireEvent.pointerDown(pickWhip, {
      button: 0,
      pointerId: 42,
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
    })
    expect(
      useItemsStore.getState().itemById[shape.id]?.transformParent?.parentItemId,
    ).toBeUndefined()
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('uses Ctrl to toggle layers and Shift to add a visible layer range', () => {
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 1,
    })
    const thirdTrack = makeTimelineTrack({
      id: 'layer-track-3',
      name: 'Triangle',
      kind: 'video',
      order: 2,
    })
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
    }
    const thirdShape: ShapeItem = {
      ...shape,
      id: 'shape-3',
      trackId: thirdTrack.id,
      label: 'Triangle',
    }
    useItemsStore.getState().setTracks([track, secondTrack, thirdTrack])
    useItemsStore.getState().setItems([shape, secondShape, thirdShape])
    render(<CompositingTimeline />)

    const first = screen.getByRole('button', { name: /1hero rectangle/i })
    const second = screen.getByRole('button', { name: /2circle/i })
    const third = screen.getByRole('button', { name: /3triangle/i })

    fireEvent.click(first)
    fireEvent.click(third, { ctrlKey: true })
    expect(useSelectionStore.getState().selectedItemIds).toEqual([shape.id, thirdShape.id])

    fireEvent.click(third, { ctrlKey: true })
    expect(useSelectionStore.getState().selectedItemIds).toEqual([shape.id])

    fireEvent.click(first)
    fireEvent.click(third, { shiftKey: true })
    expect(useSelectionStore.getState().selectedItemIds).toEqual([
      shape.id,
      secondShape.id,
      thirdShape.id,
    ])
    expect(second).toBeInTheDocument()
  })

  it('drags a layer span in time and commits one undoable move', () => {
    render(<CompositingTimeline />)
    usePlaybackStore.setState({ currentFrame: 40, previewFrame: null })
    const span = screen.getByTestId(`motion-layer-span-${shape.id}`)
    vi.spyOn(span.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 34,
      width: 300,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(span, { pointerId: 1, button: 0, clientX: 0 })
    fireEvent.pointerMove(span, { pointerId: 1, buttons: 1, clientX: 30 })
    fireEvent.pointerUp(span, { pointerId: 1, clientX: 30 })

    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(12)
    expect(usePlaybackStore.getState().currentFrame).toBe(40)
    expect(usePlaybackStore.getState().previewFrame).toBeNull()
    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(0)
  })

  it('discards a span move when the pointer interaction is cancelled', () => {
    render(<CompositingTimeline />)
    const span = screen.getByTestId(`motion-layer-span-${shape.id}`)
    vi.spyOn(span.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 34,
      width: 300,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(span, { pointerId: 2, button: 0, clientX: 0 })
    fireEvent.pointerMove(span, { pointerId: 2, buttons: 1, clientX: 30 })
    fireEvent.pointerCancel(span, { pointerId: 2, clientX: 30 })

    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(0)
  })

  it('previews start and end trims on compositor visuals and cancels without committing', () => {
    const opacityKeyframeId = useKeyframesStore.getState()._addKeyframe(shape.id, 'opacity', 10, 1)
    useComposeUiStore.setState({
      expandedLayerIdsByComposition: { 'comp-1': [shape.id] },
    })
    const trimFrameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        trimFrameCallbacks.push(callback)
        return trimFrameCallbacks.length
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {})

    render(<CompositingTimeline />)
    const span = screen.getByTestId(`motion-layer-span-${shape.id}`)
    const lane = span.parentElement!
    const startHandle = screen.getByTestId(`motion-trim-start-${shape.id}`)
    const endHandle = screen.getByTestId(`motion-trim-end-${shape.id}`)
    const keyframeVisual = screen
      .getByTestId(`row-keyframe-opacity-${opacityKeyframeId}`)
      .closest<HTMLElement>('[data-motion-span-drag-visual]')!
    const initialWidth = span.style.width
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 34,
      width: 300,
      height: 34,
      toJSON: () => ({}),
    })
    vi.spyOn(span, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 120,
      bottom: 20,
      width: 120,
      height: 20,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(startHandle, { pointerId: 11, button: 0, clientX: 25 })
    fireEvent.pointerMove(startHandle, { pointerId: 11, buttons: 1, clientX: 40 })
    act(() => trimFrameCallbacks.shift()?.(performance.now()))
    expect(span.style.translate).toBe('')
    expect(span.style.transform).not.toBe('')
    expect(span.style.width).not.toBe(initialWidth)
    expect(keyframeVisual.style.translate).toBe('')
    expect(keyframeVisual.style.transform).not.toBe('')
    fireEvent.pointerCancel(startHandle, { pointerId: 11, clientX: 40 })
    expect(span.style.translate).toBe('')
    expect(span.style.transform).toBe('')
    expect(span.style.width).toBe(initialWidth)
    expect(keyframeVisual.style.translate).toBe('')
    expect(keyframeVisual.style.transform).toBe('')
    expect(useItemsStore.getState().itemById[shape.id]).toMatchObject({
      from: 0,
      durationInFrames: 120,
    })

    fireEvent.pointerDown(endHandle, { pointerId: 12, button: 0, clientX: 200 })
    fireEvent.pointerMove(endHandle, { pointerId: 12, buttons: 1, clientX: 170 })
    act(() => trimFrameCallbacks.shift()?.(performance.now()))
    expect(span.style.translate).toBe('')
    expect(span.style.transform).toBe('')
    expect(span.style.width).not.toBe(initialWidth)
    expect(keyframeVisual.style.translate).toBe('')
    expect(keyframeVisual.style.transform).toBe('')
    fireEvent.pointerCancel(endHandle, { pointerId: 12, clientX: 170 })
    expect(span.style.width).toBe(initialWidth)
    expect(useItemsStore.getState().itemById[shape.id]).toMatchObject({
      from: 0,
      durationInFrames: 120,
    })

    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('trims a layer span from either edge and keeps each drag undoable', () => {
    useItemsStore.getState().setItems([{ ...shape, from: 10, durationInFrames: 60 }])
    render(<CompositingTimeline />)
    const startHandle = screen.getByTestId(`motion-trim-start-${shape.id}`)
    const endHandle = screen.getByTestId(`motion-trim-end-${shape.id}`)
    const lane = screen.getByTestId(`motion-layer-span-${shape.id}`).parentElement!
    vi.spyOn(lane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 34,
      width: 300,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(endHandle, { pointerId: 4, button: 0, clientX: 200 })
    fireEvent.pointerMove(endHandle, { pointerId: 4, clientX: 170 })
    fireEvent.pointerUp(endHandle, { pointerId: 4, clientX: 170 })

    expect(useItemsStore.getState().itemById[shape.id]).toMatchObject({
      from: 10,
      durationInFrames: 48,
    })

    fireEvent.pointerDown(startHandle, { pointerId: 5, button: 0, clientX: 25 })
    fireEvent.pointerMove(startHandle, { pointerId: 5, clientX: 40 })
    fireEvent.pointerUp(startHandle, { pointerId: 5, clientX: 40 })

    expect(useItemsStore.getState().itemById[shape.id]).toMatchObject({
      from: 16,
      durationInFrames: 42,
    })
    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById[shape.id]).toMatchObject({
      from: 10,
      durationInFrames: 48,
    })
  })

  it('reorders layers from the three-dot handle in one undo step', () => {
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 1,
    })
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
      shapeType: 'ellipse',
    }
    useItemsStore.getState().setTracks([track, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])

    const { container } = render(<CompositingTimeline />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-motion-row-track-id]'))
    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: index * 34,
        left: 0,
        top: index * 34,
        right: 800,
        bottom: index * 34 + 34,
        width: 800,
        height: 34,
        toJSON: () => ({}),
      })
    })

    let previewFrame: FrameRequestCallback | undefined
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        previewFrame = callback
        return 1
      })
    const handle = screen.getByTestId(`motion-reorder-handle-${secondTrack.id}`)
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientY: 51 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 5 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientY: 0 })

    expect(animationFrameSpy).toHaveBeenCalledTimes(1)
    act(() => previewFrame?.(16))
    expect(handle.closest<HTMLElement>('[data-motion-row-track-id]')?.style.transform).toBe(
      'translate3d(0, -51px, 0)',
    )

    fireEvent.pointerUp(handle, { pointerId: 2, clientY: 0 })
    animationFrameSpy.mockRestore()

    expect(
      [...useItemsStore.getState().tracks]
        .sort((left, right) => left.order - right.order)
        .map((candidate) => candidate.id),
    ).toEqual([secondTrack.id, track.id])
    useTimelineCommandStore.getState().undo()
    expect(
      [...useItemsStore.getState().tracks]
        .sort((left, right) => left.order - right.order)
        .map((candidate) => candidate.id),
    ).toEqual([track.id, secondTrack.id])
  })

  it('reorders a group as one top-level row without moving its children out', () => {
    const groupTrack = makeTimelineTrack({
      id: 'group-track',
      name: 'Group 1',
      kind: 'video',
      order: 0,
      isGroup: true,
    })
    const childTrack = makeTimelineTrack({
      ...track,
      id: 'child-track',
      order: 0,
      parentTrackId: groupTrack.id,
    })
    const topTrack = makeTimelineTrack({
      id: 'top-track',
      name: 'Top layer',
      kind: 'video',
      order: 1,
    })
    useItemsStore.getState().setTracks([groupTrack, childTrack, topTrack])
    useItemsStore.getState().setItems([
      { ...shape, trackId: childTrack.id },
      { ...shape, id: 'shape-top', trackId: topTrack.id, label: 'Top layer' },
    ])

    const { container } = render(<CompositingTimeline />)
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-motion-row-track-id]'))
    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: index * 34,
        left: 0,
        top: index * 34,
        right: 800,
        bottom: index * 34 + 34,
        width: 800,
        height: 34,
        toJSON: () => ({}),
      })
    })

    const handle = screen.getByTestId(`motion-reorder-handle-${topTrack.id}`)
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientY: 85 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 3, clientY: 0 })

    const reordered = useItemsStore.getState().tracks
    expect(reordered.find((candidate) => candidate.id === topTrack.id)?.order).toBe(0)
    expect(reordered.find((candidate) => candidate.id === groupTrack.id)?.order).toBe(1)
    expect(reordered.find((candidate) => candidate.id === childTrack.id)?.parentTrackId).toBe(
      groupTrack.id,
    )
  })

  it('groups selected layers into a collapsible parent track and can ungroup them', () => {
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 1,
    })
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
      shapeType: 'ellipse',
    }
    useItemsStore.getState().setTracks([track, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])
    useSelectionStore.getState().selectItems([shape.id, secondShape.id])

    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Create Layer Group from selected layers' }))

    const groupedState = useItemsStore.getState()
    const groupTrack = groupedState.tracks.find((candidate) => candidate.isGroup)
    expect(groupTrack).toBeDefined()
    expect(
      groupedState.tracks
        .filter((candidate) => candidate.id === track.id || candidate.id === secondTrack.id)
        .every((candidate) => candidate.parentTrackId === groupTrack?.id),
    ).toBe(true)
    expect(screen.getByTestId(`motion-group-${groupTrack!.id}`)).toBeInTheDocument()

    fireEvent.contextMenu(screen.getByTestId(`motion-group-${groupTrack!.id}`))
    expect(screen.getByRole('menuitem', { name: 'Ungroup Layers' })).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Delete Layer Group and Contents' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Ungroup Layers' }))
    expect(useItemsStore.getState().tracks.some((candidate) => candidate.isGroup)).toBe(false)
  })

  it('moves all Layer Group contents together but discards a cancelled group move', () => {
    const layerGroup = makeTimelineTrack({
      id: 'layer-group',
      name: 'Layer Group 1',
      kind: 'video',
      order: 0,
      isGroup: true,
    })
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 2,
      parentTrackId: layerGroup.id,
    })
    const firstChildTrack = { ...track, order: 1, parentTrackId: layerGroup.id }
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
      from: 20,
    }
    useItemsStore.getState().setTracks([layerGroup, firstChildTrack, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])
    const opacityKeyframeId = useKeyframesStore.getState()._addKeyframe(shape.id, 'opacity', 10, 1)
    useComposeUiStore.setState({
      expandedLayerIdsByComposition: { 'comp-1': [shape.id] },
    })
    const spanFrameCallbacks: FrameRequestCallback[] = []
    const animationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        spanFrameCallbacks.push(callback)
        return spanFrameCallbacks.length
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {})

    render(<CompositingTimeline />)
    const span = screen.getByTestId(`motion-group-span-${layerGroup.id}`)
    expect(span).toHaveClass('h-6')
    const keyframeTestId = `row-keyframe-opacity-${opacityKeyframeId}`
    const keyframeMarker = screen.getByTestId(keyframeTestId)
    const initialKeyframeLeft = keyframeMarker.style.left
    const keyframeVisual = keyframeMarker.closest<HTMLElement>('[data-motion-span-drag-visual]')!
    vi.spyOn(span.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 34,
      width: 300,
      height: 34,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(span, { pointerId: 4, button: 0, clientX: 0 })
    fireEvent.pointerMove(span, { pointerId: 4, buttons: 1, clientX: 10 })
    fireEvent.pointerMove(span, { pointerId: 4, buttons: 1, clientX: 30 })
    expect(spanFrameCallbacks).toHaveLength(1)
    act(() => spanFrameCallbacks.shift()?.(performance.now()))
    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(shape.from)
    expect(
      useKeyframesStore.getState().keyframesByItemId[shape.id]?.properties[0]?.keyframes[0]?.frame,
    ).toBe(10)
    expect(screen.getByTestId(keyframeTestId).style.left).toBe(initialKeyframeLeft)
    expect(span.style.translate).toBe('')
    expect(span.style.transform).not.toBe('')
    expect(keyframeVisual.style.translate).toBe('')
    expect(keyframeVisual.style.transform).not.toBe('')
    fireEvent.pointerUp(span, { pointerId: 4, clientX: 30 })
    expect(keyframeVisual.style.translate).toBe('')
    expect(keyframeVisual.style.transform).toBe('')
    const groupMoveDelta = useItemsStore.getState().itemById[shape.id]?.from ?? 0
    expect(groupMoveDelta).toBeGreaterThan(0)
    expect(useItemsStore.getState().itemById[secondShape.id]?.from).toBe(20 + groupMoveDelta)

    useTimelineCommandStore.getState().undo()
    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(0)
    expect(useItemsStore.getState().itemById[secondShape.id]?.from).toBe(20)

    fireEvent.pointerDown(span, { pointerId: 5, button: 0, clientX: 0 })
    fireEvent.pointerMove(span, { pointerId: 5, buttons: 1, clientX: 30 })
    fireEvent.pointerCancel(span, { pointerId: 5, clientX: 30 })
    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(0)
    expect(useItemsStore.getState().itemById[secondShape.id]?.from).toBe(20)
    animationFrameSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it('prevents child timeline and transform edits inherited from a locked Layer Group', () => {
    const layerGroup = makeTimelineTrack({
      id: 'locked-layer-group',
      name: 'Layer Group 1',
      kind: 'video',
      order: 0,
      isGroup: true,
      locked: true,
    })
    const childTrack = makeTimelineTrack({
      ...track,
      id: 'locked-child-track',
      order: 1,
      parentTrackId: layerGroup.id,
    })
    useItemsStore.getState().setTracks([layerGroup, childTrack])
    useItemsStore.getState().setItems([{ ...shape, trackId: childTrack.id }])

    render(<CompositingTimeline />)

    const childSpan = screen.getByTestId(`motion-layer-span-${shape.id}`)
    expect(childSpan).toBeDisabled()
    expect(screen.getByTestId(`motion-reorder-handle-${childTrack.id}`)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Locked by Layer Group' })).toBeDisabled()
    expect(screen.getByTestId(`motion-parent-pick-whip-${shape.id}`)).toBeDisabled()
    expect(screen.getByLabelText('In frame')).toBeDisabled()
    expect(screen.getByLabelText('Out frame')).toBeDisabled()

    fireEvent.pointerDown(childSpan, { pointerId: 7, button: 0, clientX: 0 })
    fireEvent.pointerMove(childSpan, { pointerId: 7, buttons: 1, clientX: 40 })
    fireEvent.pointerUp(childSpan, { pointerId: 7, clientX: 40 })
    expect(useItemsStore.getState().itemById[shape.id]?.from).toBe(0)
  })

  it('removes the empty former layer group when all of its children are regrouped', () => {
    const oldGroup = makeTimelineTrack({
      id: 'old-layer-group',
      name: 'Layer Group 1',
      kind: 'video',
      order: 0,
      isGroup: true,
    })
    const secondTrack = makeTimelineTrack({
      id: 'layer-track-2',
      name: 'Circle',
      kind: 'video',
      order: 2,
      parentTrackId: oldGroup.id,
    })
    const firstChildTrack = { ...track, order: 1, parentTrackId: oldGroup.id }
    const secondShape: ShapeItem = {
      ...shape,
      id: 'shape-2',
      trackId: secondTrack.id,
      label: 'Circle',
    }
    useItemsStore.getState().setTracks([oldGroup, firstChildTrack, secondTrack])
    useItemsStore.getState().setItems([shape, secondShape])
    useSelectionStore.getState().selectItems([shape.id, secondShape.id])

    render(<CompositingTimeline />)
    fireEvent.click(screen.getByRole('button', { name: 'Create Layer Group from selected layers' }))

    const layerGroups = useItemsStore.getState().tracks.filter((candidate) => candidate.isGroup)
    expect(layerGroups).toHaveLength(1)
    expect(layerGroups[0]?.id).not.toBe(oldGroup.id)
  })

  it('accepts text and shape templates dragged from the shared media sidebar', () => {
    render(<CompositingTimeline />)
    const timeline = screen.getByTestId('compositing-timeline')
    fireEvent.drop(timeline, {
      dataTransfer: makeDataTransfer({
        type: 'timeline-template',
        itemType: 'text',
        label: 'Library title',
      }),
    })

    expect(useItemsStore.getState().items).toContainEqual(
      expect.objectContaining({ type: 'text', label: 'Library title' }),
    )
  })

  it('accepts media assets dragged from the shared media library', async () => {
    const media = {
      id: 'media-image',
      fileName: 'texture.png',
      mimeType: 'image/png',
      duration: 0,
    } as MediaMetadata
    useMediaLibraryStore.setState({ mediaItems: [media], mediaById: { [media.id]: media } })
    render(<CompositingTimeline />)

    fireEvent.drop(screen.getByTestId('compositing-timeline'), {
      dataTransfer: makeDataTransfer({
        type: 'media-item',
        mediaId: media.id,
        mediaType: 'image',
        fileName: media.fileName,
        duration: media.duration,
      }),
    })

    await waitFor(() =>
      expect(useItemsStore.getState().items).toContainEqual(
        expect.objectContaining({ type: 'image', mediaId: media.id }),
      ),
    )
  })

  it('nests compositions from the media library and blocks reverse cycles', () => {
    useCompositionsStore.getState().addComposition({
      id: 'child-comp',
      name: 'Child',
      editorKind: 'composite-2d',
      tracks: [],
      items: [],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 120,
    })
    const { rerender } = render(<CompositingTimeline />)
    fireEvent.drop(screen.getByTestId('compositing-timeline'), {
      dataTransfer: makeDataTransfer({ type: 'composition', compositionId: 'child-comp' }),
    })
    expect(useItemsStore.getState().items).toContainEqual(
      expect.objectContaining({ type: 'composition', compositionId: 'child-comp' }),
    )

    openComposition('child-comp', 'Child')
    rerender(<CompositingTimeline />)
    fireEvent.drop(screen.getByTestId('compositing-timeline'), {
      dataTransfer: makeDataTransfer({ type: 'composition', compositionId: 'comp-1' }),
    })
    expect(useItemsStore.getState().items).toEqual([])
  })
})
