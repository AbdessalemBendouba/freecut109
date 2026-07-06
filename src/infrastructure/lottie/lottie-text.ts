/**
 * WASM-free helpers for reading and overriding text layers in a raw Lottie
 * (`.json`) animation. Lottie text layers have `ty === 5` and store their string
 * at `layer.t.d.k[*].s.t`. Kept separate from the dotlottie renderer so the
 * import/editing path can inspect and patch text without loading the WASM.
 *
 * Only top-level layers of raw `.json` Lotties are handled — nested precomp
 * assets and `.lottie` ZIP archives are out of scope.
 */

/** A single editable text layer discovered in a Lottie animation. */
export interface LottieTextLayer {
  /** Stable key (the layer's index) used to address the override. */
  key: string
  /** Current text content. */
  text: string
  /** Human-readable label (the layer name, or a positional fallback). */
  label: string
}

interface LottieTextData {
  d?: { k?: Array<{ s?: { t?: unknown } }> }
}
interface LottieLayer {
  ty?: unknown
  nm?: unknown
  t?: LottieTextData
}

function parseJson(json: unknown): Record<string, unknown> | null {
  if (typeof json === 'string') {
    try {
      return JSON.parse(json) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
}

function firstTextString(layer: LottieLayer): string | null {
  const keyframes = layer.t?.d?.k
  if (!Array.isArray(keyframes)) return null
  for (const kf of keyframes) {
    if (typeof kf?.s?.t === 'string') return kf.s.t
  }
  return null
}

/**
 * List the editable text layers of a raw Lottie animation, in document order.
 * Returns an empty array for non-text or unparseable input.
 */
export function extractLottieTextLayers(json: unknown): LottieTextLayer[] {
  const data = parseJson(json)
  const layers = data?.layers
  if (!Array.isArray(layers)) return []

  const result: LottieTextLayer[] = []
  layers.forEach((raw, index) => {
    const layer = raw as LottieLayer
    if (layer?.ty !== 5) return
    const text = firstTextString(layer)
    if (text === null) return
    const name = typeof layer.nm === 'string' && layer.nm.trim() ? layer.nm.trim() : ''
    result.push({ key: String(index), text, label: name || `Text ${index + 1}` })
  })
  return result
}

/**
 * Apply per-layer text overrides to a raw Lottie animation and return the
 * patched JSON string. Overrides are keyed by layer index (see
 * {@link extractLottieTextLayers}); unknown keys are ignored. Returns null when
 * the input can't be parsed or has no layers to patch.
 */
export function applyLottieTextOverrides(
  json: unknown,
  overrides: Record<string, string>,
): string | null {
  const data = parseJson(json)
  const layers = data?.layers
  if (!Array.isArray(layers)) return null
  if (Object.keys(overrides).length === 0) return null

  let changed = false
  layers.forEach((raw, index) => {
    const override = overrides[String(index)]
    if (override === undefined) return
    const layer = raw as LottieLayer
    if (layer?.ty !== 5) return
    const keyframes = layer.t?.d?.k
    if (!Array.isArray(keyframes)) return
    for (const kf of keyframes) {
      if (kf?.s && typeof kf.s.t === 'string') {
        kf.s.t = override
        changed = true
      }
    }
  })

  return changed ? JSON.stringify(data) : null
}

/**
 * Fetch a Lottie's source JSON and return it patched with `overrides`, or null
 * when there are no overrides, the source can't be read, or it isn't a raw
 * `.json` Lottie (e.g. a `.lottie` archive). Callers fall back to loading `src`
 * directly on null. Shared by the preview and export render paths.
 */
export async function resolveLottieOverrideData(
  src: string,
  overrides: Record<string, string> | undefined,
): Promise<string | null> {
  if (!overrides || Object.keys(overrides).length === 0) return null
  try {
    const text = await (await fetch(src)).text()
    return applyLottieTextOverrides(text, overrides)
  } catch {
    return null
  }
}
