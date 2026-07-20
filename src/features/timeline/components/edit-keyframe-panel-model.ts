import type { ItemKeyframes } from '@/types/keyframe'

export function hasEditableKeyframes(itemKeyframes: ItemKeyframes | null | undefined): boolean {
  if (!itemKeyframes) return false

  return (
    itemKeyframes.properties.some((entry) => entry.keyframes.length > 0) ||
    (itemKeyframes.vectorProperties ?? []).some((entry) => entry.keyframes.length > 0)
  )
}
