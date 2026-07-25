import type { TimelineItem } from '@/types/timeline'

/**
 * Vector content already responds to gizmo preview state in the DOM Player.
 * Prefer that live path during drags instead of repainting an occluding scrub
 * canvas for every pointer update. Forced rendered effects keep canvas ownership.
 */
export function shouldPreferDomPlayerForGizmo(
  _forceRenderedOverlay: boolean,
  itemType: TimelineItem['type'] | null | undefined,
): boolean {
  // A continuous GPU overlay may be enabled because the project contains an
  // effect somewhere else on the timeline. Re-compositing the full frame for
  // every vector pointer sample makes direct manipulation visibly heavy.
  // Shape/text content already has a live DOM presentation, so let it own the
  // interaction and restore the high-fidelity overlay on release.
  return itemType === 'text' || itemType === 'shape'
}
