import type {
  AnimatableProperty,
  ItemKeyframes,
  Keyframe,
  TransformAnimatableProperty,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import { getDirectPropertyLinks } from '@/types/keyframe'

export interface MotionVectorRowDefinition {
  property: VectorAnimatableProperty
  primary: TransformAnimatableProperty
  secondary: TransformAnimatableProperty
  label: string
  unit: string
}

export const MOTION_VECTOR_ROW_DEFINITIONS: readonly MotionVectorRowDefinition[] = [
  { property: 'position', primary: 'x', secondary: 'y', label: 'Position', unit: 'px' },
  { property: 'scale', primary: 'width', secondary: 'height', label: 'Scale', unit: '%' },
  { property: 'anchor', primary: 'anchorX', secondary: 'anchorY', label: 'Anchor', unit: 'px' },
]

export function getMotionVectorProxy(property: AnimatableProperty): {
  property: VectorAnimatableProperty
  axis: 'x' | 'y'
} | null {
  for (const row of MOTION_VECTOR_ROW_DEFINITIONS) {
    if (property === row.primary) return { property: row.property, axis: 'x' }
    if (property === row.secondary) return { property: row.property, axis: 'y' }
  }
  return null
}

export function getStoredMotionVectorKeyframeId(
  keyframeId: string,
  axis: 'x' | 'y',
): string {
  return axis === 'y' && keyframeId.endsWith(':y') ? keyframeId.slice(0, -2) : keyframeId
}

function getEditorMotionVectorKeyframeId(
  keyframeId: string,
  axis: 'x' | 'y',
): string {
  return axis === 'y' ? `${keyframeId}:y` : keyframeId
}

function hasScalarAuthoring(
  itemKeyframes: ItemKeyframes | undefined,
  row: MotionVectorRowDefinition,
): boolean {
  if (!itemKeyframes) return false
  const scalarProperties = new Set<AnimatableProperty>([row.primary, row.secondary])
  const hasScalarKeys = itemKeyframes.properties.some(
    (entry) => scalarProperties.has(entry.property) && entry.keyframes.length > 0,
  )
  const hasScalarLink = getDirectPropertyLinks(itemKeyframes).some((link) =>
    scalarProperties.has(link.targetProperty as AnimatableProperty),
  )
  const hasScalarExpression = itemKeyframes.expressions?.some(
    (expression) =>
      expression.type === 'expression' &&
      scalarProperties.has(expression.targetProperty as AnimatableProperty),
  )
  return hasScalarKeys || hasScalarLink || Boolean(hasScalarExpression)
}

/**
 * Motion defaults to coupled transform rows. Existing component-level authoring
 * remains separated until the user explicitly migrates it, so legacy projects
 * never lose an axis-specific link, expression, or timing lane.
 */
export function shouldUseMotionVectorRow(
  itemKeyframes: ItemKeyframes | undefined,
  row: MotionVectorRowDefinition,
): boolean {
  if (hasScalarAuthoring(itemKeyframes, row)) return false
  return true
}

export function toMotionVectorProxyKeyframes(
  keyframes: readonly VectorKeyframe[],
  axis: 'x' | 'y',
): Keyframe[] {
  return keyframes.map((keyframe) => ({
    ...keyframe,
    id: getEditorMotionVectorKeyframeId(keyframe.id, axis),
    value: keyframe.value[axis],
    spatial: undefined,
    temporalEase: undefined,
  }))
}
