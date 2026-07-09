/**
 * Recursive-halving schedule for midpoint-only frame interpolators.
 *
 * The RIFE export we ship has no timestep input — it only ever synthesizes the frame
 * halfway between its two inputs. To reach a 4x or 8x frame rate we therefore build a
 * binary tree over the gap between two consecutive source frames, feeding earlier results
 * back in as inputs.
 *
 * Positions are expressed as integer `k` in `[0, factor]`, where `k=0` is the leading
 * source frame and `k=factor` is the trailing one. A factor of 4 over source frames A,B
 * yields three steps:
 *
 *   mid(A, B)  -> k=2      (t = 0.5)
 *   mid(A, k2) -> k=1      (t = 0.25)
 *   mid(k2, B) -> k=3      (t = 0.75)
 *
 * Steps are emitted parent-before-children, so every step's operands are already available
 * when it runs. A caller can execute the list front-to-back with no dependency tracking.
 */

/** A frame the interpolator can read: one of the two source frames, or an earlier result. */
export type FrameRef =
  | { readonly kind: 'source'; readonly at: 0 | 1 }
  | { readonly kind: 'intermediate'; readonly k: number }

export interface InterpolationStep {
  readonly left: FrameRef
  readonly right: FrameRef
  /** Position of the synthesized frame, in `1..factor-1`. */
  readonly k: number
}

/** Interpolation factors reachable by pure midpoint recursion. */
export const SUPPORTED_INTERPOLATION_FACTORS = [2, 4, 8] as const
export type InterpolationFactor = (typeof SUPPORTED_INTERPOLATION_FACTORS)[number]

export function isSupportedInterpolationFactor(value: number): value is InterpolationFactor {
  return (SUPPORTED_INTERPOLATION_FACTORS as readonly number[]).includes(value)
}

function refAt(k: number, factor: number): FrameRef {
  if (k === 0) return { kind: 'source', at: 0 }
  if (k === factor) return { kind: 'source', at: 1 }
  return { kind: 'intermediate', k }
}

/**
 * Build the ordered step list that fills every intermediate position for `factor`.
 * Always emits exactly `factor - 1` steps.
 */
export function buildInterpolationPlan(factor: InterpolationFactor): InterpolationStep[] {
  if (!isSupportedInterpolationFactor(factor)) {
    throw new Error(`Unsupported interpolation factor: ${factor}`)
  }

  const steps: InterpolationStep[] = []

  // Parent before children: emitting the midpoint first guarantees both operands of every
  // subsequent step already exist.
  const halve = (lo: number, hi: number): void => {
    if (hi - lo < 2) return
    const mid = (lo + hi) / 2
    steps.push({ left: refAt(lo, factor), right: refAt(hi, factor), k: mid })
    halve(lo, mid)
    halve(mid, hi)
  }
  halve(0, factor)

  return steps
}
