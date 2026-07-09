// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { interpolateGap } from './interpolate-gap'

/**
 * A real midpoint interpolator: the exact average of its operands. Recursive halving over a
 * linear blend must reproduce the linear ramp, so the synthesized positions are analytically
 * known — this checks the recursion, not a mock.
 */
const average = async (left: Float32Array, right: Float32Array): Promise<Float32Array> =>
  left.map((value, i) => (value + right[i]!) / 2)

describe('interpolateGap', () => {
  it('returns factor-1 frames', async () => {
    const a = new Float32Array([0])
    const b = new Float32Array([1])
    expect(await interpolateGap(a, b, 2, average)).toHaveLength(1)
    expect(await interpolateGap(a, b, 4, average)).toHaveLength(3)
    expect(await interpolateGap(a, b, 8, average)).toHaveLength(7)
  })

  it('places each frame at its nominal fraction of the gap', async () => {
    const a = new Float32Array([0])
    const b = new Float32Array([1])

    for (const factor of [2, 4, 8] as const) {
      const frames = await interpolateGap(a, b, factor, average)
      const positions = frames.map((f) => f[0]!)
      const expected = Array.from({ length: factor - 1 }, (_, i) => (i + 1) / factor)
      positions.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6))
    }
  })

  it('returns frames in ascending time order, closest-to-left first', async () => {
    const frames = await interpolateGap(new Float32Array([0]), new Float32Array([8]), 8, average)
    const values = frames.map((f) => f[0]!)
    expect(values).toEqual([...values].sort((x, y) => x - y))
    expect(values[0]).toBeCloseTo(1, 6)
    expect(values[6]).toBeCloseTo(7, 6)
  })

  it('feeds synthesized frames back in as operands rather than always using the sources', async () => {
    const seen: Array<[number, number]> = []
    const spy = async (left: Float32Array, right: Float32Array): Promise<Float32Array> => {
      seen.push([left[0]!, right[0]!])
      return average(left, right)
    }
    await interpolateGap(new Float32Array([0]), new Float32Array([4]), 4, spy)

    expect(seen[0]).toEqual([0, 4]) // sources -> k=2
    expect(seen[1]).toEqual([0, 2]) // source + intermediate -> k=1
    expect(seen[2]).toEqual([2, 4]) // intermediate + source -> k=3
  })

  it('runs exactly factor-1 inferences', async () => {
    let calls = 0
    const counted = async (l: Float32Array, r: Float32Array): Promise<Float32Array> => {
      calls++
      return average(l, r)
    }
    await interpolateGap(new Float32Array([0]), new Float32Array([1]), 8, counted)
    expect(calls).toBe(7)
  })

  it('does not mutate its source frames', async () => {
    const a = new Float32Array([0.25, 0.5])
    const b = new Float32Array([0.75, 1])
    await interpolateGap(a, b, 4, average)
    expect(Array.from(a)).toEqual([0.25, 0.5])
    expect(Array.from(b)).toEqual([0.75, 1])
  })

  it('propagates interpolator failures', async () => {
    const failing = async (): Promise<Float32Array> => {
      throw new Error('inference exploded')
    }
    await expect(
      interpolateGap(new Float32Array([0]), new Float32Array([1]), 4, failing),
    ).rejects.toThrow('inference exploded')
  })
})
