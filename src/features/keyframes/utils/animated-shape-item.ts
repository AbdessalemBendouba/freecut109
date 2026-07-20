import type { ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem } from '@/types/timeline'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import type { LinkedPropertyEvaluationContext } from './animated-transform-resolver'
import {
  resolveLinkedPropertyValue,
  resolvePropertyExpressionValue,
} from './animated-transform-resolver'
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
      const postLinkValue = resolveLinkedPropertyValue(
        item.id,
        property,
        preExpressionValue,
        expressionContext,
      )
      const expressionValue = resolvePropertyExpressionValue(
        item.id,
        property,
        postLinkValue,
        expressionContext,
      ).value
      resolved[property] = typeof expressionValue === 'number' ? expressionValue : postLinkValue
    } else if (keyframes.length > 0) {
      resolved[property] = preExpressionValue
    }
  }
  return resolved
}
