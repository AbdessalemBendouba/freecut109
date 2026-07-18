import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'

interface PropertyLinkDragState {
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

export function PropertyLinkPickWhipOverlay({ drag }: { drag: PropertyLinkDragState }) {
  return (
    <PickWhipOverlay
      drag={{ ...drag, valid: Boolean(drag.sourceItemId) }}
      testId="property-link-pick-whip"
    />
  )
}
