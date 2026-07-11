import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useEffectDropPreviewStore } from '../stores/effect-drop-preview-store'
import { announceTimelineMarqueeActive } from '../utils/timeline-interaction-events'

vi.mock('./timeline-item-canvas-layer', () => ({
  TimelineItemCanvasLayer: () => <canvas data-testid="canvas-layer" />,
}))

vi.mock('./timeline-item', () => ({
  TimelineItem: ({
    item,
    onHoverChange,
  }: {
    item: TimelineItem
    onHoverChange?: (itemId: string, hovered: boolean) => void
  }) => (
    <div
      data-item-id={item.id}
      data-rich-item-id={item.id}
      onMouseEnter={() => onHoverChange?.(item.id, true)}
      onMouseLeave={() => onHoverChange?.(item.id, false)}
    />
  ),
}))

import { TimelineTrackItems } from './timeline-track-items'

const items: TimelineItem[] = [
  {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'One',
    src: 'blob:one',
  },
  {
    id: 'item-2',
    type: 'image',
    trackId: 'track-1',
    from: 35,
    durationInFrames: 30,
    label: 'Two',
    src: 'blob:two',
  },
]

function renderTrackItems() {
  return render(
    <TimelineTrackItems
      trackItems={items}
      trackLocked={false}
      trackHidden={false}
      trackHeight={72}
      hybridEnabled
    />,
  )
}

describe('TimelineTrackItems hybrid renderer', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearSelection()
    useSelectionStore.getState().setDragState(null)
    useSelectionStore.getState().setActiveTool('select')
    useSelectionStore.setState({ expandedKeyframeLanes: new Set<string>() })
    useLinkedEditPreviewStore.getState().clear()
    useEffectDropPreviewStore.getState().clearPreview()
    useTransitionDragStore.getState().clearDrag()
  })

  it('uses lightweight hit targets and promotes hovered and selected items', async () => {
    const view = renderTrackItems()

    expect(view.getByTestId('canvas-layer')).toBeInTheDocument()
    expect(view.container.querySelectorAll('[data-timeline-hit-target="true"]')).toHaveLength(2)
    expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBeNull()

    fireEvent.mouseEnter(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-1"]')!,
    )
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-1"]')).not.toBeNull()
    })

    act(() => useSelectionStore.getState().selectItems(['item-2']))
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-2"]')).not.toBeNull()
    })

    fireEvent.mouseLeave(view.container.querySelector('[data-rich-item-id="item-1"]')!)
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-1"]'),
      ).not.toBeNull()
    })
  })

  it('promotes dragged items even when they are not selected', () => {
    act(() => {
      useSelectionStore.getState().setDragState({
        isDragging: true,
        draggedItemIds: ['item-2'],
        offset: { x: 0, y: 0 },
        isAltDrag: false,
      })
    })

    const view = renderTrackItems()
    expect(view.container.querySelector('[data-rich-item-id="item-2"]')).not.toBeNull()
    expect(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-1"]'),
    ).not.toBeNull()
  })

  it('clears stale hover promotion and suppresses new promotion during marquee', async () => {
    const view = renderTrackItems()
    fireEvent.mouseEnter(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-1"]')!,
    )
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-1"]')).not.toBeNull()
    })

    act(() => announceTimelineMarqueeActive(true))
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBeNull()
    })

    fireEvent.mouseEnter(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-2"]')!,
    )
    expect(view.container.querySelector('[data-rich-item-id="item-2"]')).toBeNull()

    act(() => announceTimelineMarqueeActive(false))
    fireEvent.mouseEnter(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-2"]')!,
    )
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-2"]')).not.toBeNull()
    })
  })

  it('keeps hover promotion globally exclusive across dense tracks', async () => {
    const view = render(
      <>
        <TimelineTrackItems
          trackItems={[items[0]!]}
          trackLocked={false}
          trackHidden={false}
          trackHeight={72}
          hybridEnabled
        />
        <TimelineTrackItems
          trackItems={[items[1]!]}
          trackLocked={false}
          trackHidden={false}
          trackHeight={72}
          hybridEnabled
        />
      </>,
    )

    fireEvent.mouseEnter(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-1"]')!,
    )
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-1"]')).not.toBeNull()
    })

    fireEvent.mouseEnter(
      view.container.querySelector('[data-timeline-hit-target="true"][data-item-id="item-2"]')!,
    )
    await waitFor(() => {
      expect(view.container.querySelector('[data-rich-item-id="item-1"]')).toBeNull()
      expect(view.container.querySelector('[data-rich-item-id="item-2"]')).not.toBeNull()
    })
  })

  it('falls back to rich items for tools that require continuous edge hit testing', () => {
    act(() => useSelectionStore.getState().setActiveTool('trim-edit'))
    const view = renderTrackItems()

    expect(view.queryByTestId('canvas-layer')).toBeNull()
    expect(view.container.querySelectorAll('[data-rich-item-id]')).toHaveLength(2)
    expect(view.container.querySelector('[data-timeline-hit-target="true"]')).toBeNull()
  })
})
