import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'

interface TransformParentDragState {
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

export function TransformParentPickWhipOverlay({
  drag,
}: {
  drag: TransformParentDragState
}) {
  return (
    <PickWhipOverlay
      drag={{ ...drag, valid: Boolean(drag.sourceItemId) }}
      testId="transform-parent-pick-whip"
    />
  )
}
