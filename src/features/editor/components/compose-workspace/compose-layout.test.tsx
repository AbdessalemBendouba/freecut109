import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/editor/deps/timeline-test-helpers-contract'
import {
  openComposition,
  useCompositionNavigationStore,
  useCompositionsStore,
} from '@/features/editor/deps/timeline-motion'
import { useEditorStore } from '@/shared/state/editor'
import { useComposeUiStore } from './compose-ui-store'
import { MotionPreviewArea, MotionTimelineDock } from './compose-layout'

vi.mock('../preview-area', () => ({
  PreviewArea: ({ project }: { project: { width: number; height: number; fps: number } }) => (
    <div data-testid="preview-area">
      {project.width}x{project.height}@{project.fps}
    </div>
  ),
}))

vi.mock('./compositing-timeline', () => ({
  CompositingTimeline: () => <div data-testid="compositing-timeline" />,
}))

vi.mock('./new-composition-dialog', () => ({
  NewCompositionDialog: ({ open }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-testid="new-composition-dialog" /> : null,
}))

function addMotionComposition(id: string, name: string, width = 1920) {
  useCompositionsStore.getState().addComposition({
    id,
    name,
    editorKind: 'composite-2d',
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    fps: 30,
    width,
    height: 1080,
    durationInFrames: 300,
  })
}

describe('Motion workspace composition session', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    setDefaultRootTimelineTracks()
    useComposeUiStore.setState({
      expandedLayerIdsByComposition: {},
      lastOpenedCompositionId: null,
      motionReturnTabCaptured: false,
      motionReturnTabId: null,
    })
    useEditorStore.getState().setWorkspace('edit')
  })

  afterEach(() => {
    cleanup()
    resetTimelineCompositionTestState()
  })

  it('shows a dedicated empty canvas instead of the Edit preview', () => {
    render(<MotionPreviewArea project={{ width: 1280, height: 720, fps: 30 }} />)

    expect(screen.getByTestId('motion-preview-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-area')).not.toBeInTheDocument()
  })

  it('renders only the active Motion composition in the preview', () => {
    addMotionComposition('motion-a', 'Lower third', 1440)
    useCompositionNavigationStore.getState().switchToSequence('motion-a')

    render(<MotionPreviewArea project={{ width: 1280, height: 720, fps: 24 }} />)

    expect(screen.getByTestId('preview-area')).toHaveTextContent('1440x1080@30')
    expect(screen.queryByTestId('motion-preview-empty')).not.toBeInTheDocument()
  })

  it('reopens the last Motion composition and restores Edit when leaving', async () => {
    addMotionComposition('motion-a', 'First')
    addMotionComposition('motion-b', 'Last used')
    useComposeUiStore.getState().setLastOpenedCompositionId('motion-b')

    const view = render(
      <MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />,
    )

    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-b'),
    )
    expect(useComposeUiStore.getState().lastOpenedCompositionId).toBe('motion-b')

    view.unmount()
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
  })

  it('routes an opened Motion composition out of Edit and into Motion', async () => {
    addMotionComposition('motion-a', 'Motion composition')

    openComposition('motion-a', 'Motion composition')

    expect(useEditorStore.getState().workspace).toBe('motion')
    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a'),
    )
  })

  it('keeps the original Edit return target when the Motion dock remounts', async () => {
    addMotionComposition('motion-a', 'Motion composition')
    useEditorStore.getState().setWorkspace('motion')

    const firstMount = render(
      <MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />,
    )
    await waitFor(() =>
      expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a'),
    )

    firstMount.unmount()
    expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('motion-a')

    const secondMount = render(
      <MotionTimelineDock project={{ width: 1280, height: 720, fps: 30 }} />,
    )
    useEditorStore.getState().setWorkspace('edit')
    secondMount.unmount()

    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
    expect(useComposeUiStore.getState().motionReturnTabCaptured).toBe(false)
  })
})
