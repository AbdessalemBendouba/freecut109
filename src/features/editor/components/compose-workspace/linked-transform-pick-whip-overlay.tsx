interface LinkedExpressionDragState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  sourceItemId: string | null
  clipBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
}

export function LinkedTransformPickWhipOverlay({ drag }: { drag: LinkedExpressionDragState }) {
  const controlDistance = Math.max(48, Math.abs(drag.currentX - drag.startX) * 0.45)
  const color = drag.sourceItemId ? 'rgb(251 146 60)' : 'rgb(148 163 184)'
  const clipWidth = Math.max(0, drag.clipBounds.right - drag.clipBounds.left)
  const clipHeight = Math.max(0, drag.clipBounds.bottom - drag.clipBounds.top)
  return (
    <svg
      className="pointer-events-none fixed z-[100] overflow-hidden"
      aria-hidden="true"
      data-testid="property-link-pick-whip"
      viewBox={`${drag.clipBounds.left} ${drag.clipBounds.top} ${clipWidth} ${clipHeight}`}
      style={{
        left: drag.clipBounds.left,
        top: drag.clipBounds.top,
        width: clipWidth,
        height: clipHeight,
      }}
    >
      <path
        d={`M ${drag.startX} ${drag.startY} C ${drag.startX + controlDistance} ${drag.startY}, ${drag.currentX - controlDistance} ${drag.currentY}, ${drag.currentX} ${drag.currentY}`}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={drag.sourceItemId ? undefined : '4 4'}
      />
      <circle cx={drag.currentX} cy={drag.currentY} r="4" fill={color} />
    </svg>
  )
}
