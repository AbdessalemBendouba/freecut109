import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { useSelectionStore } from '@/shared/state/selection'
import { useTransitionDragStore } from '@/shared/state/transition-drag'
import { useLinkedEditPreviewStore } from '../stores/linked-edit-preview-store'
import { useEffectDropPreviewStore } from '../stores/effect-drop-preview-store'
import {
  announceTimelineItemHoverChange,
  subscribeToTimelineItemHoverChange,
  subscribeToTimelineMarqueeActive,
} from '../utils/timeline-interaction-events'
import { TimelineItem } from './timeline-item'
import { TimelineItemCanvasLayer } from './timeline-item-canvas-layer'
import { TimelineItemHitTarget } from './timeline-item-hit-target'

interface TimelineTrackItemsProps {
  trackItems: ReadonlyArray<TimelineItemType>
  trackLocked: boolean
  trackHidden: boolean
  trackHeight: number
  hybridEnabled: boolean
}

function RichTimelineTrackItems({
  trackItems,
  trackLocked,
  trackHidden,
  onHoverChange,
}: Omit<TimelineTrackItemsProps, 'trackHeight' | 'hybridEnabled'> & {
  onHoverChange?: (itemId: string, hovered: boolean) => void
}) {
  return (
    <>
      {trackItems.map((item) => (
        <TimelineItem
          key={item.id}
          item={item}
          timelineDuration={30}
          trackLocked={trackLocked}
          trackHidden={trackHidden}
          onHoverChange={onHoverChange}
        />
      ))}
    </>
  )
}

const HybridTimelineTrackItems = memo(function HybridTimelineTrackItems({
  trackItems,
  trackLocked,
  trackHidden,
  trackHeight,
}: Omit<TimelineTrackItemsProps, 'hybridEnabled'>) {
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const isMarqueeActiveRef = useRef(false)
  const trackItemIdSet = useMemo(() => new Set(trackItems.map((item) => item.id)), [trackItems])
  const trackItemIdSetRef = useRef(trackItemIdSet)
  trackItemIdSetRef.current = trackItemIdSet
  const selectedItemIdSet = useSelectionStore((state) => state.selectedItemIdSet)
  const draggedItemIdSet = useSelectionStore((state) => state.dragState?.draggedItemIdSet ?? null)
  const expandedKeyframeLanes = useSelectionStore((state) => state.expandedKeyframeLanes)
  const activeTool = useSelectionStore((state) => state.activeTool)
  const linkedEditPreviewUpdates = useLinkedEditPreviewStore((state) => state.updatesById)
  const effectDropTargetItemIds = useEffectDropPreviewStore((state) => state.targetItemIds)
  const isTransitionDragging = useTransitionDragStore((state) => state.draggedTransition !== null)

  const handleHoverChange = useCallback((itemId: string, hovered: boolean) => {
    announceTimelineItemHoverChange(itemId, hovered)
  }, [])

  useEffect(() => {
    const unsubscribeMarquee = subscribeToTimelineMarqueeActive((active) => {
      isMarqueeActiveRef.current = active
      if (active) setHoveredItemId(null)
    })
    const unsubscribeHover = subscribeToTimelineItemHoverChange(({ itemId, hovered }) => {
      setHoveredItemId((current) => {
        if (hovered) {
          if (isMarqueeActiveRef.current) return current
          return trackItemIdSetRef.current.has(itemId) ? itemId : null
        }
        return current === itemId ? null : current
      })
    })

    return () => {
      unsubscribeMarquee()
      unsubscribeHover()
    }
  }, [])

  const effectDropTargetSet = useMemo(
    () => new Set(effectDropTargetItemIds),
    [effectDropTargetItemIds],
  )
  const promotedItemIds = useMemo(() => {
    const promoted = new Set<string>()
    for (const item of trackItems) {
      if (
        item.id === hoveredItemId ||
        selectedItemIdSet.has(item.id) ||
        draggedItemIdSet?.has(item.id) ||
        expandedKeyframeLanes.has(item.id) ||
        linkedEditPreviewUpdates[item.id] !== undefined ||
        effectDropTargetSet.has(item.id)
      ) {
        promoted.add(item.id)
      }
    }
    return promoted
  }, [
    draggedItemIdSet,
    effectDropTargetSet,
    expandedKeyframeLanes,
    hoveredItemId,
    linkedEditPreviewUpdates,
    selectedItemIdSet,
    trackItems,
  ])

  // Tools that depend on continuous per-item edge/body hit testing retain the
  // rich DOM path. Select mode uses transparent hit targets and promotes an
  // item before its interactive pointer sequence begins.
  if (activeTool !== 'select' || isTransitionDragging) {
    return (
      <RichTimelineTrackItems
        trackItems={trackItems}
        trackLocked={trackLocked}
        trackHidden={trackHidden}
      />
    )
  }

  return (
    <>
      <TimelineItemCanvasLayer
        items={trackItems}
        promotedItemIds={promotedItemIds}
        trackHeight={trackHeight}
        trackHidden={trackHidden}
      />
      {trackItems.map((item) =>
        promotedItemIds.has(item.id) ? (
          <TimelineItem
            key={item.id}
            item={item}
            timelineDuration={30}
            trackLocked={trackLocked}
            trackHidden={trackHidden}
            onHoverChange={handleHoverChange}
          />
        ) : (
          <TimelineItemHitTarget
            key={item.id}
            item={item}
            trackLocked={trackLocked}
            onHoverChange={handleHoverChange}
          />
        ),
      )}
    </>
  )
})

/**
 * Density-adaptive item boundary. Normal projects keep the existing rich DOM
 * implementation. Dense projects use one canvas visual layer per track and
 * retain only lightweight positioned hit targets for inactive clips.
 */
export const TimelineTrackItems = memo(function TimelineTrackItems({
  hybridEnabled,
  ...props
}: TimelineTrackItemsProps) {
  if (!hybridEnabled) {
    return <RichTimelineTrackItems {...props} />
  }
  return <HybridTimelineTrackItems {...props} />
})
