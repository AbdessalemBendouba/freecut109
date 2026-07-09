// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildInterpolationPlan,
  isSupportedInterpolationFactor,
  type InterpolationFactor,
} from './interpolation-plan'

describe('buildInterpolationPlan', () => {
  it.each([2, 4, 8] as const)('emits factor-1 steps for factor %i', (factor) => {
    expect(buildInterpolationPlan(factor)).toHaveLength(factor - 1)
  })

  it('fills every intermediate position exactly once', () => {
    for (const factor of [2, 4, 8] as const) {
      const ks = buildInterpolationPlan(factor)
        .map((step) => step.k)
        .sort((a, b) => a - b)
      const expected = Array.from({ length: factor - 1 }, (_, i) => i + 1)
      expect(ks).toEqual(expected)
    }
  })

  it('orders steps so every operand is available when the step runs', () => {
    for (const factor of [2, 4, 8] as const) {
      const available = new Set<number>()
      for (const step of buildInterpolationPlan(factor)) {
        for (const ref of [step.left, step.right]) {
          if (ref.kind === 'intermediate') {
            expect(available.has(ref.k)).toBe(true)
          }
        }
        available.add(step.k)
      }
    }
  })

  it('uses the two source frames for the first step', () => {
    const [first] = buildInterpolationPlan(8)
    expect(first).toEqual({
      left: { kind: 'source', at: 0 },
      right: { kind: 'source', at: 1 },
      k: 4,
    })
  })

  it('reduces factor 2 to a single midpoint of the sources', () => {
    expect(buildInterpolationPlan(2)).toEqual([
      { left: { kind: 'source', at: 0 }, right: { kind: 'source', at: 1 }, k: 1 },
    ])
  })

  it('always halves an interval whose endpoints bracket the result', () => {
    // Guards the invariant that makes recursion valid: a step at k must interpolate two
    // positions equidistant from it, or the synthesized frame lands off its nominal time.
    const factor = 8
    const positionOf = (ref: { kind: string; at?: 0 | 1; k?: number }): number =>
      ref.kind === 'source' ? (ref.at === 0 ? 0 : factor) : ref.k!
    for (const step of buildInterpolationPlan(factor)) {
      const lo = positionOf(step.left)
      const hi = positionOf(step.right)
      expect(step.k - lo).toBe(hi - step.k)
    }
  })

  it('rejects unsupported factors', () => {
    expect(() => buildInterpolationPlan(3 as InterpolationFactor)).toThrow(/Unsupported/)
    expect(() => buildInterpolationPlan(6 as InterpolationFactor)).toThrow(/Unsupported/)
  })
})

describe('isSupportedInterpolationFactor', () => {
  it('accepts only 2, 4 and 8', () => {
    expect([1, 2, 3, 4, 5, 8, 16].filter(isSupportedInterpolationFactor)).toEqual([2, 4, 8])
  })
})
