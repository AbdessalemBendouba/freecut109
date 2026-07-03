import { useEffect, useState, type RefObject } from 'react'

/**
 * Geometry + shared constants for the in/out (IO) range markers. Kept separate
 * from the component file so fast-refresh stays happy (a module that exports
 * components must not also export plain functions/values).
 */

export const IO_HANDLE_WIDTH = 6
export const IO_HANDLE_COLOR = 'var(--color-timeline-io-handle)'

/**
 * Grip width that avoids the "solid blue block" artifact: when the in/out range
 * collapses to a few pixels wide the two fixed-width side grips would overlap and
 * cover the range bar. Cap each grip to half the range so they meet at the
 * midpoint (a clean pill spanning exactly the range) instead of overlapping.
 * `spanPx === null` (only one point set) renders a full-width grip.
 */
export function computeIoGripWidth(spanPx: number | null, nominal = IO_HANDLE_WIDTH): number {
  if (spanPx === null) return nominal
  return Math.max(0, Math.min(nominal, spanPx / 2))
}

/** Tracks an element's live pixel width (for callers that position via `%`). */
export function useMeasuredWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
