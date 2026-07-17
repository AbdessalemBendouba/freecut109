interface LinkedExpressionDragState {
  startX: number
  startY: number
  currentX: number
  currentY: number
  sourceItemId: string | null
}

export function LinkedTransformPickWhipOverlay({ drag }: { drag: LinkedExpressionDragState }) {
  const controlDistance = Math.max(48, Math.abs(drag.currentX - drag.startX) * 0.45)
  const color = drag.sourceItemId ? 'rgb(251 146 60)' : 'rgb(148 163 184)'
  return (
    <svg
      className="pointer-events-none fixed inset-0 z-[100] h-screen w-screen"
      aria-hidden="true"
      data-testid="property-link-pick-whip"
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
