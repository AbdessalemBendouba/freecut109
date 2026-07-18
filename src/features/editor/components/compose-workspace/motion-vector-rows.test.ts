import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes, VectorKeyframe } from '@/types/keyframe'
import {
  MOTION_VECTOR_ROW_DEFINITIONS,
  shouldUseMotionVectorRow,
  toMotionVectorProxyKeyframes,
} from './motion-vector-rows'

const positionRow = MOTION_VECTOR_ROW_DEFINITIONS[0]!

function keyframes(overrides: Partial<ItemKeyframes> = {}): ItemKeyframes {
  return { itemId: 'item-1', properties: [], ...overrides }
}

describe('Motion Vector2 rows', () => {
  it('couples untouched transforms and persisted vector lanes', () => {
    expect(shouldUseMotionVectorRow(undefined, positionRow)).toBe(true)
    expect(
      shouldUseMotionVectorRow(
        keyframes({ vectorProperties: [{ property: 'position', keyframes: [] }] }),
        positionRow,
      ),
    ).toBe(true)
  })

  it('preserves genuinely separated legacy axes', () => {
    expect(
      shouldUseMotionVectorRow(
        keyframes({
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'x-1', frame: 0, value: 10, easing: 'linear' }],
            },
          ],
        }),
        positionRow,
      ),
    ).toBe(false)
    expect(
      shouldUseMotionVectorRow(
        keyframes({
          propertyLinks: [
            {
              type: 'link',
              targetProperty: 'y',
              sourceItemId: 'source',
              sourceProperty: 'y',
              enabled: true,
              timeOffsetFrames: 0,
            },
          ],
        }),
        positionRow,
      ),
    ).toBe(false)
  })

  it('projects one stored vector key to component-aware graph proxies', () => {
    const stored: VectorKeyframe[] = [
      {
        id: 'position-1',
        frame: 12,
        value: { x: 40, y: 70 },
        easing: 'ease-in-out',
      },
    ]

    expect(toMotionVectorProxyKeyframes(stored, 'x')).toEqual([
      expect.objectContaining({ id: 'position-1', frame: 12, value: 40 }),
    ])
    expect(toMotionVectorProxyKeyframes(stored, 'y')).toEqual([
      expect.objectContaining({ id: 'position-1:y', frame: 12, value: 70 }),
    ])
  })
})
