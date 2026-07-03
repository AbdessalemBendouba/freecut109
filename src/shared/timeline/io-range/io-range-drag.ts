import type { PointerEvent as ReactPointerEvent } from 'react'
import { useIoRangeReadoutStore } from './io-range-readout-store'

/**
 * Start a pointer drag for an IO marker / range strip.
 *
 * - Captures the pointer (`setPointerCapture`) so the drag keeps receiving
 *   events even if the pointer is released outside the browser window — without
 *   it, `pointerup` can be missed and the drag orphans until a `pointercancel`
 *   that may never come on desktop.
 * - Routes move/end through document listeners filtered by `pointerId`, so a
 *   second touch can't hijack the active drag.
 *
 * `onMove` receives the pointer's `clientX` (all IO surfaces resolve position
 * from X only). If it returns a string, that label is shown as a cursor-following
 * readout via {@link IoDragReadout}; return nothing to skip the readout. Returns
 * a cleanup fn (store it to tear the drag down on unmount), or `null` for a
 * non-primary button.
 */
export function beginIoPointerDrag(
  e: ReactPointerEvent,
  onMove: (clientX: number) => string | void,
  onEnd?: () => void,
): (() => void) | null {
  if (e.button !== 0) return null
  e.preventDefault()
  e.stopPropagation()

  const target = e.currentTarget
  const { pointerId } = e
  try {
    target.setPointerCapture(pointerId)
  } catch {
    // Pointer capture unsupported (e.g. jsdom) — the document listeners below
    // still drive the drag; capture is only a robustness upgrade.
  }

  const publish = (clientX: number, clientY: number) => {
    const label = onMove(clientX)
    useIoRangeReadoutStore
      .getState()
      .setReadout(typeof label === 'string' ? { label, x: clientX, y: clientY } : null)
  }

  // Function declarations (hoisted) so move/end/cleanup can reference each other.
  function move(ev: PointerEvent) {
    if (ev.pointerId === pointerId) publish(ev.clientX, ev.clientY)
  }
  function end(ev: PointerEvent) {
    if (ev.pointerId === pointerId) cleanup()
  }
  function cleanup() {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', end)
    document.removeEventListener('pointercancel', end)
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      // Already released (the normal case on pointerup) — ignore.
    }
    useIoRangeReadoutStore.getState().setReadout(null)
    onEnd?.()
  }

  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', end)
  document.addEventListener('pointercancel', end)
  // Show the readout immediately on grab (before the first move).
  publish(e.clientX, e.clientY)
  return cleanup
}
