import type {
  EasingConfig,
  EasingType,
  ItemKeyframes,
  Keyframe,
  TransformAnimatableProperty,
  Vector2,
  VectorAnimatableProperty,
  VectorKeyframe,
  VectorPropertyKeyframes,
} from '@/types/keyframe'
import type { ResolvedTransform } from '@/types/transform'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'

const VECTOR_SOURCE_PROPERTIES: Record<
  VectorAnimatableProperty,
  readonly [TransformAnimatableProperty, TransformAnimatableProperty]
> = {
  position: ['x', 'y'],
  scale: ['width', 'height'],
  anchor: ['anchorX', 'anchorY'],
}

export interface VectorPromotionPlan {
  vectorProperty: VectorPropertyKeyframes
  removeScalarProperties: TransformAnimatableProperty[]
}

function getKeyframeAtOrBefore(keyframes: Keyframe[], frame: number): Keyframe | undefined {
  return keyframes.findLast((keyframe) => keyframe.frame <= frame)
}

function getSegmentStyle(
  firstAxis: Keyframe[],
  secondAxis: Keyframe[],
  frame: number,
): { easing: EasingType; easingConfig?: EasingConfig } {
  const source = getKeyframeAtOrBefore(firstAxis, frame) ?? getKeyframeAtOrBefore(secondAxis, frame)
  return {
    easing: source?.easing ?? 'linear',
    easingConfig: source?.easingConfig,
  }
}

function resolvePositionValue(
  xKeyframes: Keyframe[],
  yKeyframes: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  return {
    x: interpolatePropertyValue(xKeyframes, frame, base.x),
    y: interpolatePropertyValue(yKeyframes, frame, base.y),
  }
}

function toScalePercent(value: number, baseValue: number): number {
  return Math.abs(baseValue) <= Number.EPSILON ? 100 : (value / baseValue) * 100
}

function resolveScaleValue(
  widthKeyframes: Keyframe[],
  heightKeyframes: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  const width = interpolatePropertyValue(widthKeyframes, frame, base.width)
  const height = interpolatePropertyValue(heightKeyframes, frame, base.height)
  return {
    x: toScalePercent(width, base.width),
    y: toScalePercent(height, base.height),
  }
}

function resolveAnchorValue(
  xKeyframes: Keyframe[],
  yKeyframes: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  return {
    x: interpolatePropertyValue(xKeyframes, frame, base.anchorX),
    y: interpolatePropertyValue(yKeyframes, frame, base.anchorY),
  }
}

function resolveVectorValue(
  property: VectorAnimatableProperty,
  firstAxis: Keyframe[],
  secondAxis: Keyframe[],
  frame: number,
  base: ResolvedTransform,
): Vector2 {
  if (property === 'position') return resolvePositionValue(firstAxis, secondAxis, frame, base)
  if (property === 'scale') return resolveScaleValue(firstAxis, secondAxis, frame, base)
  return resolveAnchorValue(firstAxis, secondAxis, frame, base)
}

/**
 * Convert legacy scalar transform lanes into one coupled Animation Core v2
 * lane. The union of authored frames preserves both axes' timing landmarks;
 * a requested playhead frame is included so promotion also creates the key the
 * user asked for.
 */
export function buildVectorPromotionPlan(params: {
  property: VectorAnimatableProperty
  itemKeyframes: ItemKeyframes | undefined
  baseTransform: ResolvedTransform
  /** Optional authored frame to seed while promoting from the inspector. */
  includeFrame?: number
  createId?: (frame: number) => string
}): VectorPromotionPlan {
  const { property, itemKeyframes, baseTransform } = params
  const [firstProperty, secondProperty] = VECTOR_SOURCE_PROPERTIES[property]
  const firstAxis = getPropertyKeyframes(itemKeyframes, firstProperty)
  const secondAxis = getPropertyKeyframes(itemKeyframes, secondProperty)
  const frames = new Set([
    ...firstAxis.map((keyframe) => keyframe.frame),
    ...secondAxis.map((keyframe) => keyframe.frame),
  ])
  if (typeof params.includeFrame === 'number') {
    frames.add(Math.max(0, Math.round(params.includeFrame)))
  }
  const createId = params.createId ?? (() => crypto.randomUUID())
  const keyframes: VectorKeyframe[] = Array.from(frames)
    .sort((left, right) => left - right)
    .map((frame) => ({
      id: createId(frame),
      frame,
      value: resolveVectorValue(property, firstAxis, secondAxis, frame, baseTransform),
      ...getSegmentStyle(firstAxis, secondAxis, frame),
    }))

  return {
    vectorProperty: { property, keyframes },
    removeScalarProperties: [firstProperty, secondProperty],
  }
}
