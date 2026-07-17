import type { BuiltInAnimatableProperty, ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem } from '@/types/timeline'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'

export type ShapeAnimatableProperty =
  | 'trimPathStart'
  | 'trimPathEnd'
  | 'trimPathOffset'
  | 'taperStartWidth'
  | 'taperEndWidth'
  | 'taperStartLength'
  | 'taperEndLength'

const SHAPE_ANIMATABLE_PROPERTIES: ShapeAnimatableProperty[] = [
  'trimPathStart',
  'trimPathEnd',
  'trimPathOffset',
  'taperStartWidth',
  'taperEndWidth',
  'taperStartLength',
  'taperEndLength',
]

const SHAPE_PROPERTY_DEFAULTS: Record<ShapeAnimatableProperty, number> = {
  trimPathStart: 0,
  trimPathEnd: 100,
  trimPathOffset: 0,
  taperStartWidth: 100,
  taperEndWidth: 100,
  taperStartLength: 0,
  taperEndLength: 0,
}

export function isShapeAnimatableProperty(
  property: BuiltInAnimatableProperty | string,
): property is ShapeAnimatableProperty {
  return SHAPE_ANIMATABLE_PROPERTIES.includes(property as ShapeAnimatableProperty)
}

export function getShapeAnimatableBaseValue(
  item: ShapeItem,
  property: ShapeAnimatableProperty,
): number {
  return item[property] ?? SHAPE_PROPERTY_DEFAULTS[property]
}

export function resolveAnimatedShapeItem(
  item: ShapeItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
): ShapeItem {
  if (!itemKeyframes) return item

  const resolved = { ...item }
  for (const property of SHAPE_ANIMATABLE_PROPERTIES) {
    const keyframes = getPropertyKeyframes(itemKeyframes, property)
    if (keyframes.length > 0) {
      resolved[property] = interpolatePropertyValue(
        keyframes,
        frame,
        getShapeAnimatableBaseValue(item, property),
      )
    }
  }
  return resolved
}
