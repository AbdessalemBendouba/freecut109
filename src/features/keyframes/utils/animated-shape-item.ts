import type { ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem } from '@/types/timeline'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import type { LinkedPropertyEvaluationContext } from './animated-transform-resolver'
import { resolveLinkedPropertyValue } from './animated-transform-resolver'
import {
  getShapeAnimatableBaseValue,
  SHAPE_ANIMATABLE_PROPERTIES,
} from './shape-animatable-properties'

export {
  getShapeAnimatableBaseValue,
  isShapeAnimatableProperty,
} from './shape-animatable-properties'

export function resolveAnimatedShapeItem(
  item: ShapeItem,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  expressionContext?: LinkedPropertyEvaluationContext,
): ShapeItem {
  if (!itemKeyframes) return item

  const resolved = { ...item }
  for (const property of SHAPE_ANIMATABLE_PROPERTIES) {
    const keyframes = getPropertyKeyframes(itemKeyframes, property)
    const baseValue = getShapeAnimatableBaseValue(item, property)
    const preExpressionValue = interpolatePropertyValue(keyframes, frame, baseValue)
    if (expressionContext) {
      resolved[property] = resolveLinkedPropertyValue(
        item.id,
        property,
        preExpressionValue,
        expressionContext,
      )
    } else if (keyframes.length > 0) {
      resolved[property] = preExpressionValue
    }
  }
  return resolved
}
