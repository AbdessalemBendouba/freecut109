/**
 * Animated transform resolver.
 * Merges keyframe-animated values with base transform properties.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import type {
  ItemKeyframes,
  LinkableAnimatableProperty,
  TransformAnimatableProperty,
} from '@/types/keyframe'
import { isShapeAnimatableProperty, isTransformAnimatableProperty } from '@/types/keyframe'
import { getSourceDimensions, resolveTransform } from '../deps/composition-runtime-contract'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'
import { getShapeAnimatableBaseValue } from './shape-animatable-properties'
import { getVectorPropertyKeyframes, interpolateVectorPropertyValue } from './vector-interpolation'

/**
 * All animatable transform properties (excludes non-spatial props like volume).
 */
const ANIMATABLE_TRANSFORM_PROPERTIES: TransformAnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
]

export interface LinkedPropertyEvaluationContext {
  /** Composition frame, shared by the target and every linked source. */
  globalFrame: number
  canvas: CanvasSettings
  getItem: (itemId: string) => TimelineItem | undefined
  getKeyframes: (itemId: string) => ItemKeyframes | undefined
}

interface LinkedTransformEvaluationState {
  cache: Map<string, number>
  active: Set<string>
}

function getPreExpressionValue(
  item: TimelineItem,
  property: LinkableAnimatableProperty,
  context: LinkedPropertyEvaluationContext,
): number | null {
  let base: number
  if (isTransformAnimatableProperty(property)) {
    const resolved = resolveAnimatedTransform(
      resolveTransform(item, context.canvas, getSourceDimensions(item)),
      context.getKeyframes(item.id),
      context.globalFrame - item.from,
    )
    return resolved[property]
  } else if (isShapeAnimatableProperty(property) && item.type === 'shape') {
    base = getShapeAnimatableBaseValue(item, property)
  } else {
    return null
  }
  const keyframes = getPropertyKeyframes(context.getKeyframes(item.id), property)
  const relativeFrame = context.globalFrame - item.from
  return interpolatePropertyValue(keyframes, relativeFrame, base)
}

export function resolveLinkedPropertyValue(
  itemId: string,
  property: LinkableAnimatableProperty,
  preExpressionValue: number,
  context: LinkedPropertyEvaluationContext,
  state: LinkedTransformEvaluationState = { cache: new Map(), active: new Set() },
): number {
  const dependencyKey = `${itemId}:${property}`
  const cacheKey = `${dependencyKey}@${context.globalFrame}`
  const cached = state.cache.get(cacheKey)
  if (cached !== undefined) return cached

  // Imported or legacy projects can contain a cycle even though the UI blocks
  // creating one. Fall back to the property's pre-expression value rather than
  // recursing forever or poisoning the rendered frame with NaN.
  if (state.active.has(dependencyKey)) return preExpressionValue

  const expression = context
    .getKeyframes(itemId)
    ?.expressions?.find((candidate) => candidate.targetProperty === property && candidate.enabled)
  if (!expression) {
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }

  const sourceItem = context.getItem(expression.sourceItemId)
  if (!sourceItem) {
    // Broken references are non-fatal and leave the target's authored value in
    // place. The UI can still expose the broken link for repair or removal.
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }

  state.active.add(dependencyKey)
  const sourceContext =
    expression.timeOffsetFrames === 0
      ? context
      : { ...context, globalFrame: context.globalFrame - expression.timeOffsetFrames }
  const sourcePreExpressionValue = getPreExpressionValue(
    sourceItem,
    expression.sourceProperty,
    sourceContext,
  )
  if (sourcePreExpressionValue === null) {
    state.active.delete(dependencyKey)
    state.cache.set(cacheKey, preExpressionValue)
    return preExpressionValue
  }
  const value = resolveLinkedPropertyValue(
    sourceItem.id,
    expression.sourceProperty,
    sourcePreExpressionValue,
    sourceContext,
    state,
  )
  state.active.delete(dependencyKey)
  state.cache.set(cacheKey, value)
  return value
}

interface VectorTransformAnimation {
  result: ResolvedTransform
  hasPosition: boolean
  hasScale: boolean
  hasAnchor: boolean
}

function resolveVectorTransformAnimation(
  baseResolved: ResolvedTransform,
  itemKeyframes: ItemKeyframes,
  frame: number,
  fps: number | undefined,
): VectorTransformAnimation {
  const result = { ...baseResolved }
  const positionKeyframes = getVectorPropertyKeyframes(itemKeyframes, 'position')
  const scaleKeyframes = getVectorPropertyKeyframes(itemKeyframes, 'scale')
  const anchorKeyframes = getVectorPropertyKeyframes(itemKeyframes, 'anchor')

  if (positionKeyframes.length > 0) {
    const position = interpolateVectorPropertyValue(
      'position',
      positionKeyframes,
      frame,
      { x: baseResolved.x, y: baseResolved.y },
      fps,
    )
    result.x = position.x
    result.y = position.y
  }

  if (scaleKeyframes.length > 0) {
    const scale = interpolateVectorPropertyValue(
      'scale',
      scaleKeyframes,
      frame,
      { x: 100, y: 100 },
      fps,
    )
    result.width = baseResolved.width * (scale.x / 100)
    result.height = baseResolved.height * (scale.y / 100)
  }

  if (anchorKeyframes.length > 0) {
    const anchor = interpolateVectorPropertyValue(
      'anchor',
      anchorKeyframes,
      frame,
      { x: baseResolved.anchorX, y: baseResolved.anchorY },
      fps,
    )
    result.anchorX = anchor.x
    result.anchorY = anchor.y
  }

  return {
    result,
    hasPosition: positionKeyframes.length > 0,
    hasScale: scaleKeyframes.length > 0,
    hasAnchor: anchorKeyframes.length > 0,
  }
}

function isControlledByVectorAnimation(
  property: TransformAnimatableProperty,
  vectorAnimation: Pick<VectorTransformAnimation, 'hasPosition' | 'hasScale' | 'hasAnchor'>,
): boolean {
  if (vectorAnimation.hasPosition && (property === 'x' || property === 'y')) return true
  if (vectorAnimation.hasScale && (property === 'width' || property === 'height')) return true
  return vectorAnimation.hasAnchor && (property === 'anchorX' || property === 'anchorY')
}

function resolveScalarTransformProperty(params: {
  property: TransformAnimatableProperty
  baseResolved: ResolvedTransform
  vectorAnimation: VectorTransformAnimation
  itemKeyframes: ItemKeyframes
  frame: number
  expressionContext: LinkedPropertyEvaluationContext | undefined
  expressionState: LinkedTransformEvaluationState
}): number {
  const {
    property,
    baseResolved,
    vectorAnimation,
    itemKeyframes,
    frame,
    expressionContext,
    expressionState,
  } = params
  const keyframes = getPropertyKeyframes(itemKeyframes, property)
  const controlledByVector = isControlledByVectorAnimation(property, vectorAnimation)
  const baseValue = controlledByVector ? vectorAnimation.result[property] : baseResolved[property]
  const preExpressionValue = controlledByVector
    ? baseValue
    : interpolatePropertyValue(keyframes, frame, baseValue)

  if (expressionContext) {
    return resolveLinkedPropertyValue(
      itemKeyframes.itemId,
      property,
      preExpressionValue,
      expressionContext,
      expressionState,
    )
  }
  return keyframes.length > 0 ? preExpressionValue : vectorAnimation.result[property]
}

/**
 * Resolve an animated transform at a specific frame.
 * Merges keyframe-animated values with the base resolved transform.
 *
 * @param baseResolved - The base resolved transform (without animation)
 * @param itemKeyframes - All keyframes for the item
 * @param frame - Current frame relative to item start
 * @returns ResolvedTransform with animated values applied
 */
export function resolveAnimatedTransform(
  baseResolved: ResolvedTransform,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
  expressionContext?: LinkedPropertyEvaluationContext,
): ResolvedTransform {
  // No animation data - return base transform unchanged.
  if (!itemKeyframes) {
    return baseResolved
  }

  const vectorAnimation = resolveVectorTransformAnimation(
    baseResolved,
    itemKeyframes,
    frame,
    expressionContext?.canvas.fps,
  )

  const expressionState: LinkedTransformEvaluationState = {
    cache: new Map(),
    active: new Set(),
  }

  // Keyframes produce the pre-expression value. A valid link then replaces it
  // with the source property's post-expression value at composition time.
  for (const property of ANIMATABLE_TRANSFORM_PROPERTIES) {
    vectorAnimation.result[property] = resolveScalarTransformProperty({
      property,
      baseResolved,
      vectorAnimation,
      itemKeyframes,
      frame,
      expressionContext,
      expressionState,
    })
  }

  return vectorAnimation.result
}

/**
 * Check if an item has any keyframe animations.
 *
 * @param itemKeyframes - All keyframes for the item
 * @returns True if the item has at least one keyframe
 */
export function hasKeyframeAnimation(itemKeyframes: ItemKeyframes | undefined): boolean {
  if (!itemKeyframes) return false
  return (
    itemKeyframes.properties.some((p) => p.keyframes.length > 0) ||
    (itemKeyframes.vectorProperties?.some((property) => property.keyframes.length > 0) ?? false) ||
    (itemKeyframes.expressions?.some((expression) => expression.enabled) ?? false)
  )
}

/** Return the direct scalar link for a target property, including disabled links. */
function getLinkedPropertyExpression(
  itemKeyframes: ItemKeyframes | undefined,
  property: LinkableAnimatableProperty,
) {
  return itemKeyframes?.expressions?.find((expression) => expression.targetProperty === property)
}

/**
 * Check whether adding `candidate` would introduce a dependency cycle. Broken
 * existing references are ignored because they cannot lead back to the target.
 */
export function wouldCreateLinkedPropertyCycle(
  itemId: string,
  property: LinkableAnimatableProperty,
  sourceItemId: string,
  sourceProperty: LinkableAnimatableProperty,
  getKeyframes: (candidateItemId: string) => ItemKeyframes | undefined,
): boolean {
  const targetKey = `${itemId}:${property}`
  let currentItemId = sourceItemId
  let currentProperty = sourceProperty
  const visited = new Set<string>()

  while (true) {
    const key = `${currentItemId}:${currentProperty}`
    if (key === targetKey) return true
    if (visited.has(key)) return false
    visited.add(key)

    const next = getLinkedPropertyExpression(getKeyframes(currentItemId), currentProperty)
    if (!next?.enabled) return false
    currentItemId = next.sourceItemId
    currentProperty = next.sourceProperty
  }
}
