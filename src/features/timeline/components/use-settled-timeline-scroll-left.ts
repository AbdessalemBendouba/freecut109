import {
  startTransition,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'

export const EDIT_DOPESHEET_PAN_SETTLE_MS = 90
export const EDIT_DOPESHEET_PAN_REBASE_VIEWPORT_RATIO = 0.75

/**
 * Keeps expensive keyframe geometry off the main timeline's per-frame pan path.
 * The dopesheet translates its already-rendered geometry from live scrollLeft;
 * this value only refreshes the React geometry occasionally and after settling.
 */
export function useSettledTimelineScrollLeft(
  scrollContainerRef: RefObject<HTMLDivElement | null> | undefined,
  enabled: boolean,
): number {
  const [scrollLeft, setScrollLeft] = useState(
    () => useTimelineViewportStore.getState().scrollLeft,
  )
  const publishedScrollLeftRef = useRef(scrollLeft)

  useLayoutEffect(() => {
    if (!enabled) return
    const container = scrollContainerRef?.current
    if (!container) return

    let settleTimeout: ReturnType<typeof setTimeout> | null = null
    const publish = () => {
      if (settleTimeout !== null) {
        clearTimeout(settleTimeout)
        settleTimeout = null
      }
      const nextScrollLeft = container.scrollLeft
      if (Math.abs(nextScrollLeft - publishedScrollLeftRef.current) < 0.5) return
      publishedScrollLeftRef.current = nextScrollLeft
      startTransition(() => setScrollLeft(nextScrollLeft))
    }

    const handleScroll = () => {
      const viewportWidth = container.clientWidth
      const rebaseDistance = viewportWidth * EDIT_DOPESHEET_PAN_REBASE_VIEWPORT_RATIO
      if (
        viewportWidth > 0 &&
        Math.abs(container.scrollLeft - publishedScrollLeftRef.current) >= rebaseDistance
      ) {
        publish()
      }
      if (settleTimeout !== null) clearTimeout(settleTimeout)
      settleTimeout = setTimeout(publish, EDIT_DOPESHEET_PAN_SETTLE_MS)
    }

    // The DOM is authoritative and may be ahead of the throttled viewport store
    // when the panel opens in the middle of a momentum gesture.
    publish()
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (settleTimeout !== null) clearTimeout(settleTimeout)
    }
  }, [enabled, scrollContainerRef])

  return scrollLeft
}
