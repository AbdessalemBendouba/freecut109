import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem } from '@/types/timeline'
import { resolveAnimatedShapeItem } from './animated-shape-item'

const shape: ShapeItem = {
  id: 'shape-1',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 60,
  label: 'Path',
  shapeType: 'path',
  fillColor: '#00000000',
  strokeColor: '#ffffff',
  strokeWidth: 4,
}

describe('resolveAnimatedShapeItem', () => {
  it('interpolates trim-path properties from their After Effects-style defaults', () => {
    const keyframes: ItemKeyframes = {
      itemId: shape.id,
      properties: [
        {
          property: 'trimPathEnd',
          keyframes: [
            { id: 'a', frame: 0, value: 0, easing: 'linear' },
            { id: 'b', frame: 30, value: 100, easing: 'linear' },
          ],
        },
        {
          property: 'trimPathOffset',
          keyframes: [{ id: 'c', frame: 0, value: 45, easing: 'linear' }],
        },
      ],
    }

    const resolved = resolveAnimatedShapeItem(shape, keyframes, 15)
    expect(resolved.trimPathStart).toBeUndefined()
    expect(resolved.trimPathEnd).toBe(50)
    expect(resolved.trimPathOffset).toBe(45)
  })

  it('interpolates taper properties from neutral stroke defaults', () => {
    const keyframes: ItemKeyframes = {
      itemId: shape.id,
      properties: [
        {
          property: 'taperStartWidth',
          keyframes: [
            { id: 'a', frame: 0, value: 100, easing: 'linear' },
            { id: 'b', frame: 30, value: 0, easing: 'linear' },
          ],
        },
        {
          property: 'taperStartLength',
          keyframes: [{ id: 'c', frame: 0, value: 40, easing: 'linear' }],
        },
      ],
    }

    const resolved = resolveAnimatedShapeItem(shape, keyframes, 15)
    expect(resolved.taperStartWidth).toBe(50)
    expect(resolved.taperStartLength).toBe(40)
  })
})
