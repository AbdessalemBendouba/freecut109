// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { concatPlanarPair, framesDiffer, planarRgbToRgba, rgbaToPlanarRgb } from './frame-tensor'

function makeRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 7) % 256
    rgba[i * 4 + 1] = (i * 13) % 256
    rgba[i * 4 + 2] = (i * 29) % 256
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

describe('rgbaToPlanarRgb', () => {
  it('deinterleaves into contiguous R, G and B planes', () => {
    const width = 3
    const height = 2
    // pixel 0 = (10, 20, 30), pixel 5 = (60, 70, 80); rest zero.
    const rgba = new Uint8ClampedArray(width * height * 4)
    rgba.set([10, 20, 30, 255], 0)
    rgba.set([60, 70, 80, 255], 5 * 4)

    const planar = rgbaToPlanarRgb(rgba, width, height)
    const pixels = width * height

    expect(planar[0]).toBeCloseTo(10 / 255, 6)
    expect(planar[pixels + 0]).toBeCloseTo(20 / 255, 6)
    expect(planar[pixels * 2 + 0]).toBeCloseTo(30 / 255, 6)

    expect(planar[5]).toBeCloseTo(60 / 255, 6)
    expect(planar[pixels + 5]).toBeCloseTo(70 / 255, 6)
    expect(planar[pixels * 2 + 5]).toBeCloseTo(80 / 255, 6)
  })

  it('drops alpha rather than folding it into the colour planes', () => {
    const rgba = new Uint8ClampedArray([200, 100, 50, 0])
    const planar = rgbaToPlanarRgb(rgba, 1, 1)
    expect(planar).toHaveLength(3)
    expect(planar[0]).toBeCloseTo(200 / 255, 6)
  })

  it('rejects a buffer too small for the stated dimensions', () => {
    expect(() => rgbaToPlanarRgb(new Uint8ClampedArray(4), 2, 2)).toThrow(/expected 16 bytes/)
  })
})

describe('planarRgbToRgba', () => {
  it('round-trips 8-bit values exactly', () => {
    const width = 8
    const height = 4
    const rgba = makeRgba(width, height)
    const restored = planarRgbToRgba(rgbaToPlanarRgb(rgba, width, height), width, height)
    expect(Array.from(restored)).toEqual(Array.from(rgba))
  })

  it('saturates values outside [0,1] instead of wrapping', () => {
    // RIFE's final layer is unbounded and routinely overshoots by a fraction of a step.
    const planar = new Float32Array([-0.4, 1.6, 0.5])
    const rgba = planarRgbToRgba(planar, 1, 1)
    expect(rgba[0]).toBe(0)
    expect(rgba[1]).toBe(255)
    expect(rgba[2]).toBe(128)
  })

  it('writes an opaque alpha channel', () => {
    const rgba = planarRgbToRgba(new Float32Array([0, 0, 0]), 1, 1)
    expect(rgba[3]).toBe(255)
  })

  it('rejects a tensor too small for the stated dimensions', () => {
    expect(() => planarRgbToRgba(new Float32Array(3), 2, 2)).toThrow(/expected 12 floats/)
  })
})

describe('concatPlanarPair', () => {
  it('stacks left into channels 0-2 and right into 3-5', () => {
    const width = 2
    const height = 2
    const planeCount = 3 * width * height
    const left = new Float32Array(planeCount).fill(0.25)
    const right = new Float32Array(planeCount).fill(0.75)

    const packed = concatPlanarPair(left, right, width, height)

    expect(packed).toHaveLength(planeCount * 2)
    expect(packed.slice(0, planeCount).every((v) => v === 0.25)).toBe(true)
    expect(packed.slice(planeCount).every((v) => v === 0.75)).toBe(true)
  })

  it('does not alias its operands', () => {
    const left = new Float32Array(3).fill(1)
    const right = new Float32Array(3).fill(0)
    const packed = concatPlanarPair(left, right, 1, 1)
    packed[0] = 0.5
    expect(left[0]).toBe(1)
  })

  it('rejects operands shorter than one planar frame', () => {
    expect(() => concatPlanarPair(new Float32Array(3), new Float32Array(12), 2, 2)).toThrow(
      /shorter than one planar RGB frame/,
    )
  })
})

describe('framesDiffer', () => {
  it('reports no difference for identical frames', () => {
    const a = new Float32Array([0.1, 0.2, 0.3])
    expect(framesDiffer(a, Float32Array.from(a), 0)).toBe(false)
  })

  it('excludes the threshold itself, so a change of exactly the threshold is noise', () => {
    const a = new Float32Array([0.5])
    const b = new Float32Array([0.5 + 3 / 255])
    expect(framesDiffer(a, b, 3 / 255)).toBe(false)
  })

  it('reports a difference just past the threshold', () => {
    const a = new Float32Array([0.5])
    const b = new Float32Array([0.5 + 3.001 / 255])
    expect(framesDiffer(a, b, 3 / 255)).toBe(true)
  })

  it('detects a change in any channel, including the last', () => {
    const a = new Float32Array([0, 0, 0, 0])
    for (let i = 0; i < a.length; i++) {
      const b = Float32Array.from(a)
      b[i] = 1
      expect(framesDiffer(a, b, 0.01)).toBe(true)
    }
  })

  it('detects a decrease as well as an increase', () => {
    expect(framesDiffer(new Float32Array([0.5]), new Float32Array([0.1]), 0.01)).toBe(true)
  })

  it('reports a difference unconditionally for a negative threshold', () => {
    const a = new Float32Array([0.25])
    expect(framesDiffer(a, Float32Array.from(a), -1)).toBe(true)
  })

  it('rejects frames of different lengths', () => {
    expect(() => framesDiffer(new Float32Array(3), new Float32Array(4), 0)).toThrow(
      /length mismatch, 3 vs 4/,
    )
  })
})
