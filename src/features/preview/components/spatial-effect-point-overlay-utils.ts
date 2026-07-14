import type { ItemEffect } from '@/types/effects'
import type { Point } from '../types/gizmo'

export function buildSpatialPointEffects(
  effects: ItemEffect[],
  effectId: string,
  xParam: string,
  yParam: string,
  point: Point,
): ItemEffect[] {
  return effects.map((entry) => {
    if (entry.id !== effectId || entry.effect.type !== 'gpu-effect') return entry
    return {
      ...entry,
      effect: {
        ...entry.effect,
        params: {
          ...entry.effect.params,
          [xParam]: point.x,
          [yParam]: point.y,
        },
      },
    }
  })
}
