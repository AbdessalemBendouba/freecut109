import type { PointerEvent as ReactPointerEvent } from 'react'

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
 * from X only). Returns a cleanup fn (store it to tear the drag down on
 * unmount), or `null` for a non-primary button.
 */
export function beginIoPointerDrag(
  e: ReactPointerEvent,
  onMove: (clientX: number) => void,
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

  // Function declarations (hoisted) so move/end/cleanup can reference each other.
  function move(ev: PointerEvent) {
    if (ev.pointerId === pointerId) onMove(ev.clientX)
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
    onEnd?.()
  }

  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', end)
  document.addEventListener('pointercancel', end)
  return cleanup
}
