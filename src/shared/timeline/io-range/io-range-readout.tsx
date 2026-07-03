import { memo } from 'react'
import { createPortal } from 'react-dom'
import { useIoRangeReadoutStore } from './io-range-readout-store'

/**
 * Floating readout shown at the cursor during an IO drag (mirrors the clip trim
 * readout / TransitionDragTooltip). Mount once, high in the tree — it portals to
 * `document.body` and positions in viewport coords, so a single instance covers
 * every IO surface (Edit ruler, mini-timeline, source monitor).
 */
export const IoDragReadout = memo(function IoDragReadout() {
  const readout = useIoRangeReadoutStore((s) => s.readout)
  if (!readout) return null

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: 'fixed',
        left: readout.x,
        top: readout.y - 16,
        transform: 'translate(-50%, -100%)',
        zIndex: 10000,
      }}
    >
      <div className="rounded-md border border-slate-200/70 bg-slate-900/92 px-2 py-1 text-[11px] font-medium tabular-nums text-slate-50 shadow-xl backdrop-blur-sm">
        {readout.label}
      </div>
    </div>,
    document.body,
  )
})
