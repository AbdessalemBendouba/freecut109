import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { AudioItem, ControllerItem, TimelineItem, VideoItem } from '@/types/timeline'
import { ClipPanel } from './index'

vi.mock('./layout-section', () => ({
  LayoutSection: () => <div>Layout Body</div>,
}))

vi.mock('./fill-section', () => ({
  FillSection: () => <div>Fill Body</div>,
}))

vi.mock('./corner-pin-section', () => ({
  CornerPinSection: () => <div>Corner Pin Body</div>,
}))

vi.mock('./video-section', () => ({
  VideoSection: () => <div>Video Body</div>,
}))

vi.mock('./gif-section', () => ({
  GifSection: () => <div>Gif Body</div>,
}))

vi.mock('./audio-section', () => ({
  AudioSection: () => <div>Audio Body</div>,
}))

vi.mock('./text-section', () => ({
  TextSection: () => <div>Text Body</div>,
  TextContentSection: () => <div>Text Content Body</div>,
  TextEffectsSection: () => <div>Text Effects Body</div>,
}))

vi.mock('./shape-section', () => ({
  ShapeSection: () => <div>Shape Body</div>,
}))

vi.mock('../../animate-workspace/animation-preset-library', () => ({
  AnimationPresetLibrary: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="motion-library-mock" data-embedded={String(embedded)} />
  ),
}))

vi.mock('@/features/editor/deps/effects-contract', () => ({
  EffectsSection: () => <div>Effects Body</div>,
}))

const VIDEO_ITEM: VideoItem = {
  id: 'clip-video-1',
  type: 'video',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip.mp4',
  src: 'blob:video',
  mediaId: 'media-video-1',
}

const AUDIO_ITEM: AudioItem = {
  id: 'clip-audio-1',
  type: 'audio',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 90,
  label: 'clip.wav',
  src: 'blob:audio',
  mediaId: 'media-audio-1',
}

const NULL_OBJECT: ControllerItem = {
  id: 'null-1',
  type: 'controller',
  controllerKind: 'null',
  trackId: 'null-track',
  from: 0,
  durationInFrames: 90,
  label: 'Null Object',
  transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
}

const TRANSFORM_REFERENCE = { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 }

function activateTab(name: 'Audio' | 'Effects' | 'Motion' | 'Video') {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.focus(tab)
}

function resetStores(items: TimelineItem[], selectedItemIds: string[]) {
  useEditorStore.setState({
    workspace: 'edit',
    clipInspectorTab: 'video',
    linkedSelectionEnabled: true,
  })

  useSelectionStore.setState({
    selectedItemIds,
    selectedMarkerId: null,
    selectedTransitionId: null,
    selectedTrackId: null,
    selectedTrackIds: [],
    activeTrackId: null,
    selectionType: selectedItemIds.length > 0 ? 'item' : null,
    dragState: null,
  })

  useTimelineStore.setState({
    fps: 30,
    items,
    keyframes: [],
  } as Partial<ReturnType<typeof useTimelineStore.getState>>)
}

describe('ClipPanel inspector tabs', () => {
  beforeEach(() => {
    resetStores([VIDEO_ITEM], [VIDEO_ITEM.id])
  })

  it('restores the last selected clip tab after deselecting and reselecting', async () => {
    render(<ClipPanel />)

    activateTab('Effects')

    expect(screen.getByText('Effects Body')).toBeInTheDocument()
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects')

    act(() => {
      useSelectionStore.getState().selectItems([])
    })

    await waitFor(() => {
      expect(screen.queryByText('Effects Body')).not.toBeInTheDocument()
    })
    expect(useEditorStore.getState().clipInspectorTab).toBe('effects')

    act(() => {
      useSelectionStore.getState().selectItems([VIDEO_ITEM.id])
    })

    await waitFor(() => {
      expect(screen.getByText('Effects Body')).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: 'Effects' })).toHaveAttribute('data-state', 'active')
  })

  it('falls back to the first valid tab and updates the remembered tab', async () => {
    useEditorStore.getState().setClipInspectorTab('video')
    resetStores([AUDIO_ITEM], [AUDIO_ITEM.id])

    render(<ClipPanel />)

    await waitFor(() => {
      expect(screen.getByText('Audio Body')).toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: 'Audio' })).toHaveAttribute('data-state', 'active')
    expect(useEditorStore.getState().clipInspectorTab).toBe('audio')
  })

  it('embeds the complete motion library as a selected-layer tab in Motion', async () => {
    useEditorStore.setState({ workspace: 'motion' })

    render(<ClipPanel />)

    activateTab('Motion')

    expect(await screen.findByTestId('motion-library-mock')).toHaveAttribute(
      'data-embedded',
      'true',
    )
    expect(useEditorStore.getState().clipInspectorTab).toBe('motion')
    expect(screen.getByText('Parenting')).toBeInTheDocument()
    expect(
      screen.getByText('Choose a Null Object or layer to move, scale, and rotate them together.'),
    ).toBeInTheDocument()
  })

  it('hides parenting from an ordinary unparented clip in Edit', () => {
    render(<ClipPanel />)

    expect(screen.queryByText('Parenting')).not.toBeInTheDocument()
  })

  it('keeps an existing parent relationship reachable in Edit', () => {
    const parentedVideo: VideoItem = {
      ...VIDEO_ITEM,
      transformParent: {
        parentItemId: NULL_OBJECT.id,
        parentReference: TRANSFORM_REFERENCE,
        childLocalReference: TRANSFORM_REFERENCE,
        childWorldReference: TRANSFORM_REFERENCE,
      },
    }
    resetStores([NULL_OBJECT, parentedVideo], [parentedVideo.id])

    render(<ClipPanel />)

    expect(screen.getByText('Parenting')).toBeInTheDocument()
    expect(
      screen.getByText('Follows Null Object for position, scale, and rotation.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Parent selection to new Null' }),
    ).not.toBeInTheDocument()
  })

  it('names the invisible rig layer as a Null Object', () => {
    resetStores([NULL_OBJECT], [NULL_OBJECT.id])

    render(<ClipPanel />)

    expect(screen.getByRole('tab', { name: 'Null Object' })).toBeInTheDocument()
  })

  it('offers one shared parent control for a multi-layer Motion selection', () => {
    const secondVideo: VideoItem = {
      ...VIDEO_ITEM,
      id: 'clip-video-2',
      trackId: 'track-2',
      label: 'second.mp4',
    }
    resetStores([VIDEO_ITEM, secondVideo], [VIDEO_ITEM.id, secondVideo.id])
    useEditorStore.setState({ workspace: 'motion' })

    render(<ClipPanel />)
    activateTab('Motion')

    expect(screen.getByText('Parenting')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Choose a Null Object or layer to move, scale, and rotate 2 layers together.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Parent selection to new Null' }))

    const state = useTimelineStore.getState()
    const nullParent = state.items.find((item) => item.type === 'controller')
    const firstChild = state.items.find((item) => item.id === VIDEO_ITEM.id)
    const secondChild = state.items.find((item) => item.id === secondVideo.id)
    expect(nullParent).toMatchObject({ label: 'Null Object', controllerKind: 'null' })
    expect(firstChild?.transformParent?.parentItemId).toBe(nullParent?.id)
    expect(secondChild?.transformParent?.parentItemId).toBe(nullParent?.id)
    expect(useSelectionStore.getState().selectedItemIds).toEqual([nullParent?.id])
  })
})
