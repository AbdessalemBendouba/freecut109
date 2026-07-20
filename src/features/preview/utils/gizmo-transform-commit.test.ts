// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { MotionAnimationLayer, MotionModifier } from '@/types/motion'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { buildGizmoTransformCommit, resolveEditableGizmoTransform } from './gizmo-transform-commit'

const base: ResolvedTransform = {
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  anchorX: 100,
  anchorY: 50,
  rotation: 30,
  opacity: 1,
  cornerRadius: 0,
}

const layer: MotionAnimationLayer = {
  id: 'layer-1',
  name: 'Slide',
  enabled: true,
  source: 'built-in-preset',
  sourcePresetId: 'slide',
  tracks: [
    {
      property: 'x',
      blend: 'add',
      keyframes: [{ id: 'layer-kf', frame: 30, value: 20, easing: 'linear' }],
    },
  ],
}

const spin: MotionModifier = {
  id: 'spin-1',
  type: 'spin',
  enabled: true,
  amplitude: 1,
  frequency: 0.1,
  phaseFrames: 0,
  seed: 1,
}

const item = {
  id: 'item-1',
  type: 'shape',
  trackId: 'track-1',
  from: 10,
  durationInFrames: 100,
  label: 'Shape',
  motionLayers: [layer],
  motionModifiers: [spin],
} as TimelineItem

describe('gizmo transform commits', () => {
  it('removes live layer and modifier contributions from the visual pose', () => {
    const editable = resolveEditableGizmoTransform({
      item,
      visualTransform: { ...base, x: 120, rotation: 66 },
      relativeFrame: 30,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })

    expect(editable.x).toBeCloseTo(100)
    expect(editable.rotation).toBeCloseTo(30)
  })

  it('writes coupled Position and Scale lanes instead of legacy scalar lanes', () => {
    const keyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'p0', frame: 0, value: { x: 100, y: 50 }, easing: 'linear' },
          ],
        },
        {
          property: 'scale',
          keyframes: [
            { id: 's0', frame: 0, value: { x: 100, y: 100 }, easing: 'linear' },
          ],
        },
      ],
    }

    const commit = buildGizmoTransformCommit({
      item,
      itemKeyframes: keyframes,
      transform: { ...base, x: 200, y: 125, width: 400, height: 300 },
      baseTransform: base,
      currentFrame: 15,
    })

    expect(commit.autoOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'vector-add',
          property: 'position',
          value: { x: 200, y: 125 },
        }),
        expect.objectContaining({
          type: 'vector-add',
          property: 'scale',
          value: { x: 200, y: 300 },
        }),
      ]),
    )
    expect(commit.transformProps).not.toHaveProperty('x')
    expect(commit.transformProps).not.toHaveProperty('width')
  })
})
