import type { ItemKeyframes, Keyframe, PropertyKeyframes } from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'
import type { CoordinateParams, Point } from '../types/gizmo'
import { resolveItemTransformAtFrame } from '../deps/composition-runtime'
import { getEffectiveScale } from './coordinate-transform'

export interface MotionPathPoint {
  frame: number
  x: number
  y: number
  isKeyframe: boolean
}

export interface MotionPathScreenPoint extends MotionPathPoint {
  screenX: number
  screenY: number
}

function hasPositionKeyframes(itemKeyframes: ItemKeyframes | undefined): boolean {
  return (
    itemKeyframes?.properties.some(
      (property) =>
        (property.property === 'x' || property.property === 'y') && property.keyframes.length > 0,
    ) ?? false
  )
}

/** Procedural modifiers that move the item's position (drive a motion path). */
function hasPositionModifiers(item: TimelineItem): boolean {
  return (
    item.motionModifiers?.some(
      (modifier) =>
        modifier.enabled &&
        modifier.amplitude > 0 &&
        (modifier.type === 'float-drift' || modifier.type === 'micro-shake'),
    ) ?? false
  )
}

function getPositionKeyframeFrames(
  item: TimelineItem,
  itemKeyframes: ItemKeyframes | undefined,
): Set<number> {
  const frames = new Set<number>()
  for (const property of itemKeyframes?.properties ?? []) {
    if (property.property !== 'x' && property.property !== 'y') continue
    for (const keyframe of property.keyframes) {
      const absoluteFrame = item.from + keyframe.frame
      if (absoluteFrame >= item.from && absoluteFrame < item.from + item.durationInFrames) {
        frames.add(absoluteFrame)
      }
    }
  }
  return frames
}

function getEvenSampleFrames(startFrame: number, endFrame: number, maxSamples: number): number[] {
  const span = endFrame - startFrame
  if (span <= 0) return [startFrame]

  const sampleCount = Math.max(2, Math.min(maxSamples, span + 1))
  return Array.from({ length: sampleCount }, (_, index) =>
    Math.round(startFrame + (span * index) / (sampleCount - 1)),
  )
}

function hasVisibleMovement(points: MotionPathPoint[]): boolean {
  const first = points[0]
  if (!first) return false
  return points.some(
    (point) => Math.abs(point.x - first.x) > 0.5 || Math.abs(point.y - first.y) > 0.5,
  )
}

/** Temporary id for the injected drag-preview keyframe (never persisted). */
const PREVIEW_KEYFRAME_ID = '__motion-path-preview__'

/**
 * Fold a live gizmo-drag position into the item's x/y keyframes as a keyframe at
 * the dragged frame — an upsert — so the motion path previews the pending edit
 * (matching the auto-keyframe the drag will commit) without waiting for release.
 */
function applyPreviewKeyframe(
  itemKeyframes: ItemKeyframes,
  preview: { frame: number; x: number; y: number },
): ItemKeyframes {
  const upsert = (properties: PropertyKeyframes[], property: 'x' | 'y', value: number) => {
    // Distinct per-axis id so consumers that dedupe keyframes by id never collide.
    const previewId = `${PREVIEW_KEYFRAME_ID}-${property}`
    const index = properties.findIndex((group) => group.property === property)
    if (index === -1) {
      // No group for this axis yet — seed one with the preview keyframe so the
      // dragged axis still moves instead of silently staying put.
      const seededGroup: PropertyKeyframes = {
        property,
        keyframes: [{ id: previewId, frame: preview.frame, value, easing: 'linear' }],
      }
      return [...properties, seededGroup]
    }
    const group = properties[index]!
    let keyframes: Keyframe[]
    if (group.keyframes.some((keyframe) => keyframe.frame === preview.frame)) {
      keyframes = group.keyframes.map((keyframe) =>
        keyframe.frame === preview.frame ? { ...keyframe, value } : keyframe,
      )
    } else {
      // Inherit the incoming segment's easing so the previewed curve matches.
      const easing =
        group.keyframes.filter((keyframe) => keyframe.frame < preview.frame).at(-1)?.easing ??
        'linear'
      keyframes = [
        ...group.keyframes,
        { id: previewId, frame: preview.frame, value, easing },
      ].sort((left, right) => left.frame - right.frame)
    }
    const next = [...properties]
    next[index] = { ...group, keyframes }
    return next
  }

  return {
    ...itemKeyframes,
    properties: upsert(upsert(itemKeyframes.properties, 'x', preview.x), 'y', preview.y),
  }
}

export function buildMotionPathPoints(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  canvas: CanvasSettings
  maxSamples?: number
  /**
   * Live gizmo-drag position (item-relative frame + transform-space x/y). When
   * set, the path previews the drag by upserting a keyframe at that frame.
   */
  preview?: { frame: number; x: number; y: number }
}): MotionPathPoint[] {
  const { item, canvas, preview } = params
  const baseKeyframes = params.itemKeyframes
  const itemKeyframes =
    preview && baseKeyframes && hasPositionKeyframes(baseKeyframes)
      ? applyPreviewKeyframe(baseKeyframes, preview)
      : baseKeyframes
  if (!hasPositionKeyframes(itemKeyframes) && !hasPositionModifiers(item)) return []

  const startFrame = item.from
  const endFrame = item.from + Math.max(0, item.durationInFrames - 1)
  if (endFrame <= startFrame) return []

  const keyframeFrames = getPositionKeyframeFrames(item, itemKeyframes)
  const frames = new Set([
    ...getEvenSampleFrames(startFrame, endFrame, Math.max(2, params.maxSamples ?? 36)),
    ...keyframeFrames,
  ])

  const points = Array.from(frames)
    .sort((left, right) => left - right)
    .map((frame) => {
      const transform = resolveItemTransformAtFrame(item, {
        canvas,
        frame,
        keyframes: itemKeyframes,
      })
      return {
        frame,
        x: canvas.width / 2 + transform.x,
        y: canvas.height / 2 + transform.y,
        isKeyframe: keyframeFrames.has(frame),
      }
    })

  return hasVisibleMovement(points) ? points : []
}

export function canvasPointToMotionPathScreenPoint(
  point: MotionPathPoint,
  coordParams: CoordinateParams,
): MotionPathScreenPoint {
  const scale = getEffectiveScale(coordParams)
  return {
    ...point,
    screenX: point.x * scale,
    screenY: point.y * scale,
  }
}

export function canvasPointToPlayerPoint(point: Point, coordParams: CoordinateParams): Point {
  const scale = getEffectiveScale(coordParams)
  return {
    x: point.x * scale,
    y: point.y * scale,
  }
}
