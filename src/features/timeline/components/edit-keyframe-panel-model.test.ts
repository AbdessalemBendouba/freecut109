import { describe, expect, it } from 'vitest'

import type { ItemKeyframes } from '@/types/keyframe'
import { hasEditableKeyframes } from './edit-keyframe-panel-model'

describe('Edit keyframe panel model', () => {
  it('detects scalar and vector keyframes', () => {
    const scalar: ItemKeyframes = {
      itemId: 'scalar-clip',
      properties: [
        {
          property: 'opacity',
          keyframes: [{ id: 'opacity-1', frame: 0, value: 1, easing: 'linear' }],
        },
      ],
    }
    const vector: ItemKeyframes = {
      itemId: 'vector-clip',
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            {
              id: 'position-1',
              frame: 0,
              value: { x: 10, y: 20 },
              easing: 'linear',
            },
          ],
        },
      ],
    }

    expect(hasEditableKeyframes(scalar)).toBe(true)
    expect(hasEditableKeyframes(vector)).toBe(true)
  })

  it('rejects missing and empty keyframe data', () => {
    expect(hasEditableKeyframes(null)).toBe(false)
    expect(hasEditableKeyframes({ itemId: 'empty', properties: [] })).toBe(false)
  })
})
