/** Shared pointer lifecycle for Parent, Property Link, and Expression pick whips. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export interface MotionPickWhipClipBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface MotionPickWhipCandidate<TValue> {
  row: HTMLElement
  value: TValue
}

export interface MotionPickWhipModifiers {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

interface MotionPickWhipDragState<TOrigin, TCandidate> {
  pointerId: number
  origin: TOrigin
  startX: number
  startY: number
  currentX: number
  currentY: number
  moved: boolean
  candidate: MotionPickWhipCandidate<TCandidate> | null
  clipBounds: MotionPickWhipClipBounds
}

interface UseMotionPickWhipDragOptions<TOrigin, TCandidate> {
  hoverAttribute: string
  getClipRoot?: (originElement: HTMLElement) => HTMLElement | null
  resolveCandidate: (
    clientX: number,
    clientY: number,
    origin: TOrigin,
  ) => MotionPickWhipCandidate<TCandidate> | null
  onCommit: (
    origin: TOrigin,
    candidate: TCandidate,
    modifiers: MotionPickWhipModifiers,
  ) => void
}

const AUTO_SCROLL_EDGE_PX = 48
const AUTO_SCROLL_MAX_PX_PER_SECOND = 720

function getAutoScrollVelocity(
  pointerX: number,
  pointerY: number,
  bounds: MotionPickWhipClipBounds,
): number {
  if (
    pointerX < bounds.left ||
    pointerX > bounds.right ||
    pointerY < bounds.top ||
    pointerY > bounds.bottom
  ) {
    return 0
  }
  const topDepth = AUTO_SCROLL_EDGE_PX - (pointerY - bounds.top)
  if (topDepth > 0) {
    return -AUTO_SCROLL_MAX_PX_PER_SECOND * (topDepth / AUTO_SCROLL_EDGE_PX)
  }
  const bottomDepth = AUTO_SCROLL_EDGE_PX - (bounds.bottom - pointerY)
  if (bottomDepth > 0) {
    return AUTO_SCROLL_MAX_PX_PER_SECOND * (bottomDepth / AUTO_SCROLL_EDGE_PX)
  }
  return 0
}

function updateHover(
  hoverRef: MutableRefObject<HTMLElement | null>,
  row: HTMLElement | null,
  attribute: string,
): void {
  if (hoverRef.current === row) return
  hoverRef.current?.removeAttribute(attribute)
  if (row) row.setAttribute(attribute, 'true')
  hoverRef.current = row
}

function getClipBounds(root: HTMLElement): MotionPickWhipClipBounds {
  const rect = root.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

export function useMotionPickWhipDrag<TOrigin, TCandidate>(
  options: UseMotionPickWhipDragOptions<TOrigin, TCandidate>,
) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [drag, setDrag] = useState<MotionPickWhipDragState<TOrigin, TCandidate> | null>(null)
  const dragRef = useRef<MotionPickWhipDragState<TOrigin, TCandidate> | null>(null)
  const hoverRef = useRef<HTMLElement | null>(null)
  const originElementRef = useRef<HTMLElement | null>(null)
  const clipRootRef = useRef<HTMLElement | null>(null)
  const layoutFrameRef = useRef<number | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)
  const autoScrollTimeRef = useRef<number | null>(null)

  const begin = useCallback((event: ReactPointerEvent<HTMLElement>, origin: TOrigin) => {
    if (event.button !== 0) return
    const clipRoot =
      optionsRef.current.getClipRoot?.(event.currentTarget) ??
      event.currentTarget.closest<HTMLElement>(
        '[data-pick-whip-scroll-area], [data-testid="motion-layer-scroll-area"]',
      )
    if (!clipRoot) return
    const rect = event.currentTarget.getBoundingClientRect()
    const next: MotionPickWhipDragState<TOrigin, TCandidate> = {
      pointerId: event.pointerId,
      origin,
      startX: rect.left + rect.width / 2,
      startY: rect.top + rect.height / 2,
      currentX: event.clientX,
      currentY: event.clientY,
      moved: false,
      candidate: null,
      clipBounds: getClipBounds(clipRoot),
    }
    originElementRef.current = event.currentTarget
    clipRootRef.current = clipRoot
    dragRef.current = next
    setDrag(next)
  }, [])

  useEffect(() => {
    const clearHover = () =>
      updateHover(hoverRef, null, optionsRef.current.hoverAttribute)
    const cancelLayoutRefresh = () => {
      if (layoutFrameRef.current === null) return
      window.cancelAnimationFrame(layoutFrameRef.current)
      layoutFrameRef.current = null
    }
    const refreshFromLayout = () => {
      layoutFrameRef.current = null
      const current = dragRef.current
      const originElement = originElementRef.current
      const clipRoot = clipRootRef.current
      if (!current || !originElement?.isConnected || !clipRoot?.isConnected) return
      const candidate = optionsRef.current.resolveCandidate(
        current.currentX,
        current.currentY,
        current.origin,
      )
      updateHover(hoverRef, candidate?.row ?? null, optionsRef.current.hoverAttribute)
      const rect = originElement.getBoundingClientRect()
      const next = {
        ...current,
        startX: rect.left + rect.width / 2,
        startY: rect.top + rect.height / 2,
        candidate,
        clipBounds: getClipBounds(clipRoot),
      }
      dragRef.current = next
      setDrag(next)
    }
    const scheduleLayoutRefresh = () => {
      if (!dragRef.current || layoutFrameRef.current !== null) return
      layoutFrameRef.current = window.requestAnimationFrame(refreshFromLayout)
    }
    const cancelAutoScroll = () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      autoScrollTimeRef.current = null
    }
    const autoScroll = (timestamp: number) => {
      autoScrollFrameRef.current = null
      const current = dragRef.current
      const clipRoot = clipRootRef.current
      if (!current || !clipRoot) {
        autoScrollTimeRef.current = null
        return
      }
      const velocity = getAutoScrollVelocity(
        current.currentX,
        current.currentY,
        current.clipBounds,
      )
      if (velocity === 0) {
        autoScrollTimeRef.current = null
        return
      }
      const previousTimestamp = autoScrollTimeRef.current ?? timestamp - 1000 / 60
      const elapsedSeconds = Math.min(32, Math.max(0, timestamp - previousTimestamp)) / 1000
      autoScrollTimeRef.current = timestamp
      const previousScrollTop = clipRoot.scrollTop
      const maxScrollTop = Math.max(0, clipRoot.scrollHeight - clipRoot.clientHeight)
      clipRoot.scrollTop = Math.min(
        maxScrollTop,
        Math.max(0, previousScrollTop + velocity * elapsedSeconds),
      )
      if (clipRoot.scrollTop === previousScrollTop) {
        autoScrollTimeRef.current = null
        return
      }
      scheduleLayoutRefresh()
      autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll)
    }
    const updateAutoScroll = () => {
      const current = dragRef.current
      if (
        !current ||
        getAutoScrollVelocity(current.currentX, current.currentY, current.clipBounds) === 0
      ) {
        cancelAutoScroll()
        return
      }
      if (autoScrollFrameRef.current !== null) return
      autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll)
    }
    const move = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) return
      const candidate = optionsRef.current.resolveCandidate(
        event.clientX,
        event.clientY,
        current.origin,
      )
      updateHover(hoverRef, candidate?.row ?? null, optionsRef.current.hoverAttribute)
      const next = {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
        moved:
          current.moved ||
          Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 3,
        candidate,
      }
      dragRef.current = next
      setDrag(next)
      updateAutoScroll()
    }
    const finish = (event: PointerEvent, commit: boolean) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) return
      clearHover()
      cancelLayoutRefresh()
      cancelAutoScroll()
      dragRef.current = null
      originElementRef.current = null
      clipRootRef.current = null
      setDrag(null)
      if (!commit || !current.moved || !current.candidate) return
      optionsRef.current.onCommit(current.origin, current.candidate.value, {
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      })
    }
    const pointerUp = (event: PointerEvent) => finish(event, true)
    const pointerCancel = (event: PointerEvent) => finish(event, false)
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return
      clearHover()
      cancelLayoutRefresh()
      cancelAutoScroll()
      dragRef.current = null
      originElementRef.current = null
      clipRootRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('scroll', scheduleLayoutRefresh, true)
    window.addEventListener('resize', scheduleLayoutRefresh)
    return () => {
      clearHover()
      cancelLayoutRefresh()
      cancelAutoScroll()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('scroll', scheduleLayoutRefresh, true)
      window.removeEventListener('resize', scheduleLayoutRefresh)
    }
  }, [])

  return { drag, begin }
}
