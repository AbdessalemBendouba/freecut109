/**
 * Conversions between packed 8-bit RGBA (what canvases and `VideoFrame`s give us) and the
 * planar float RGB layout the RIFE ONNX graph expects.
 *
 * Planar RGB is the interpolator's internal frame currency, not just its input format: RIFE's
 * output tensor is already `[1, 3, H, W]` float, so synthesized frames never round-trip through
 * 8 bits before they are encoded.
 *
 * Layout: `value(c, y, x) = data[c * H * W + y * W + x]`, channels R,G,B, range [0, 1].
 */

/** Number of floats in a planar RGB frame. */
export function planarRgbLength(width: number, height: number): number {
  return 3 * width * height
}

export function rgbaToPlanarRgb(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const pixels = width * height
  if (rgba.length < pixels * 4) {
    throw new Error(`rgbaToPlanarRgb: expected ${pixels * 4} bytes, got ${rgba.length}`)
  }
  const dst = out ?? new Float32Array(3 * pixels)

  // Plane views + a reciprocal multiply: this runs 921k times per 720p frame, so the
  // per-element offset arithmetic and the divide both show up in a profile.
  const r = dst.subarray(0, pixels)
  const g = dst.subarray(pixels, pixels * 2)
  const b = dst.subarray(pixels * 2, pixels * 3)
  const inv = 1 / 255
  for (let i = 0, s = 0; i < pixels; i++, s += 4) {
    r[i] = rgba[s]! * inv
    g[i] = rgba[s + 1]! * inv
    b[i] = rgba[s + 2]! * inv
  }
  return dst
}

export function planarRgbToRgba(
  planar: Float32Array,
  width: number,
  height: number,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const pixels = width * height
  if (planar.length < 3 * pixels) {
    throw new Error(`planarRgbToRgba: expected ${3 * pixels} floats, got ${planar.length}`)
  }
  const dst = out ?? new Uint8ClampedArray(pixels * 4)

  const r = planar.subarray(0, pixels)
  const g = planar.subarray(pixels, pixels * 2)
  const b = planar.subarray(pixels * 2, pixels * 3)
  for (let i = 0, d = 0; i < pixels; i++, d += 4) {
    // Uint8ClampedArray clamps to [0,255] and rounds on assignment, which is exactly the
    // saturation RIFE's unbounded output needs — it can overshoot slightly past 0 and 1.
    dst[d] = r[i]! * 255
    dst[d + 1] = g[i]! * 255
    dst[d + 2] = b[i]! * 255
    dst[d + 3] = 255
  }
  return dst
}

/**
 * Whether any channel of any pixel moved by more than `threshold`.
 *
 * Returns on the first pixel that moved, so footage in motion pays only for the leading
 * static region. A negative threshold reports a difference unconditionally.
 */
export function framesDiffer(a: Float32Array, b: Float32Array, threshold: number): boolean {
  if (a.length !== b.length) {
    throw new Error(`framesDiffer: length mismatch, ${a.length} vs ${b.length}`)
  }
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > threshold) return true
  }
  return false
}

/**
 * Stack two planar RGB frames into the `[1, 6, H, W]` input tensor: `left` occupies
 * channels 0-2, `right` channels 3-5.
 */
export function concatPlanarPair(
  left: Float32Array,
  right: Float32Array,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const planeCount = 3 * width * height
  if (left.length < planeCount || right.length < planeCount) {
    throw new Error('concatPlanarPair: operand shorter than one planar RGB frame')
  }
  const dst = out ?? new Float32Array(planeCount * 2)
  dst.set(left.subarray(0, planeCount), 0)
  dst.set(right.subarray(0, planeCount), planeCount)
  return dst
}
