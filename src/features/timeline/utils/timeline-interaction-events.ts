const TIMELINE_MARQUEE_ACTIVE_EVENT = 'freecut:timeline-marquee-active'
const TIMELINE_ITEM_HOVER_CHANGE_EVENT = 'freecut:timeline-item-hover-change'

interface TimelineItemHoverChangeDetail {
  itemId: string
  hovered: boolean
}

export function announceTimelineMarqueeActive(active: boolean): void {
  window.dispatchEvent(
    new CustomEvent<{ active: boolean }>(TIMELINE_MARQUEE_ACTIVE_EVENT, {
      detail: { active },
    }),
  )
}

export function subscribeToTimelineMarqueeActive(listener: (active: boolean) => void): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<{ active: boolean }>).detail.active)
  }

  window.addEventListener(TIMELINE_MARQUEE_ACTIVE_EVENT, handleEvent)
  return () => window.removeEventListener(TIMELINE_MARQUEE_ACTIVE_EVENT, handleEvent)
}

export function announceTimelineItemHoverChange(itemId: string, hovered: boolean): void {
  window.dispatchEvent(
    new CustomEvent<TimelineItemHoverChangeDetail>(TIMELINE_ITEM_HOVER_CHANGE_EVENT, {
      detail: { itemId, hovered },
    }),
  )
}

export function subscribeToTimelineItemHoverChange(
  listener: (detail: TimelineItemHoverChangeDetail) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<TimelineItemHoverChangeDetail>).detail)
  }

  window.addEventListener(TIMELINE_ITEM_HOVER_CHANGE_EVENT, handleEvent)
  return () => window.removeEventListener(TIMELINE_ITEM_HOVER_CHANGE_EVENT, handleEvent)
}
