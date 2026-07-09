/**
 * Fill the gap between two consecutive source frames with `factor - 1` synthesized frames,
 * by executing a recursive-halving plan against any midpoint interpolator.
 */

import type { InterpolationFactor, FrameRef } from './interpolation-plan'
import { buildInterpolationPlan } from './interpolation-plan'

/** Synthesizes the frame halfway between two planar RGB frames. */
export type MidpointInterpolator = (
  left: Float32Array,
  right: Float32Array,
) => Promise<Float32Array>

/**
 * Returns the intermediates in output order: index 0 is position `k=1`, the frame closest to
 * `left`. Neither source frame is included.
 */
export async function interpolateGap(
  left: Float32Array,
  right: Float32Array,
  factor: InterpolationFactor,
  interpolate: MidpointInterpolator,
): Promise<Float32Array[]> {
  const plan = buildInterpolationPlan(factor)
  const byPosition = new Map<number, Float32Array>()

  const resolve = (ref: FrameRef): Float32Array => {
    if (ref.kind === 'source') {
      return ref.at === 0 ? left : right
    }
    const frame = byPosition.get(ref.k)
    if (!frame) {
      throw new Error(`interpolateGap: step depends on unresolved position k=${ref.k}`)
    }
    return frame
  }

  for (const step of plan) {
    byPosition.set(step.k, await interpolate(resolve(step.left), resolve(step.right)))
  }

  const ordered: Float32Array[] = []
  for (let k = 1; k < factor; k++) {
    const frame = byPosition.get(k)
    if (!frame) throw new Error(`interpolateGap: plan left position k=${k} unfilled`)
    ordered.push(frame)
  }
  return ordered
}
