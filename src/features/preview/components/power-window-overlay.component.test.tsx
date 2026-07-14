import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { useGizmoStore } from '../stores/gizmo-store'
import { usePowerWindowEditorStore } from '../stores/power-window-editor-store'
import { PowerWindowOverlayContainer } from './power-window-overlay'

const mocks = vi.hoisted(() => {
  const item: TimelineItem = {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 120,
    label: 'clip.mp4',
    src: 'blob:clip-1',
    mediaId: 'media-1',
    effects: [
      {
        id: 'window-1',
        enabled: true,
        effect: {
          type: 'gpu-effect',
          gpuEffectType: 'gpu-power-window',
          params: {
            shape: 'ellipse',
            centerX: 0.5,
            centerY: 0.5,
            sizeX: 0.5,
            sizeY: 0.5,
            rotation: 0,
          },
        },
      },
    ],
  }
  return {
    selectionState: { selectedItemIds: ['clip-1'] },
    timelineState: { items: [item], setItemEffects: vi.fn() },
  }
})

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: (selector: (state: typeof mocks.selectionState) => unknown) =>
    selector(mocks.selectionState),
}))

vi.mock('../deps/timeline-store', () => ({
  useItemsStore: (selector: (state: typeof mocks.timelineState) => unknown) =>
    selector(mocks.timelineState),
  useTimelineStore: (selector: (state: typeof mocks.timelineState) => unknown) =>
    selector(mocks.timelineState),
}))

const overlayProps = {
  containerRect: new DOMRect(0, 0, 960, 540),
  playerSize: { width: 960, height: 540 },
  projectSize: { width: 1920, height: 1080 },
  zoom: 1,
}

describe('PowerWindowOverlayContainer', () => {
  beforeEach(() => {
    usePowerWindowEditorStore.getState().stopEditing()
    useGizmoStore.getState().clearPreview()
  })

  it('only shows the targeted window in edit mode and exits on Escape', () => {
    render(<PowerWindowOverlayContainer {...overlayProps} />)
    expect(screen.queryByTestId('power-window-overlay')).not.toBeInTheDocument()

    act(() => {
      usePowerWindowEditorStore.getState().startEditing('clip-1', 'window-1')
    })
    const overlay = screen.getByTestId('power-window-overlay')
    expect(overlay).toHaveStyle({ left: '0px', top: '0px', width: '960px', height: '540px' })
    expect(screen.getByRole('button', { name: 'Move power window' }).parentElement).toHaveStyle({
      left: '50%',
      top: '50%',
      width: '50%',
      height: '50%',
      borderRadius: '50%',
    })
    expect(screen.getByRole('button', { name: 'Rotate power window' })).toHaveAttribute(
      'title',
      'Rotate power window · Hold Shift to snap to 15°',
    )

    act(() => {
      const effect = mocks.timelineState.items[0]!.effects![0]!
      useGizmoStore.getState().setEffectsPreviewNew({
        'clip-1': [
          {
            ...effect,
            effect: {
              ...effect.effect,
              params: { ...effect.effect.params, centerX: 0.72 },
            },
          },
        ],
      })
    })
    expect(screen.getByRole('button', { name: 'Move power window' }).parentElement).toHaveStyle({
      left: '72%',
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('power-window-overlay')).not.toBeInTheDocument()
    expect(usePowerWindowEditorStore.getState().isEditing).toBe(false)
    expect(useGizmoStore.getState().preview).toBeNull()
  })
})
