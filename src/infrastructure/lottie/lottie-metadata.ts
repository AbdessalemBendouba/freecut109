/**
 * WASM-free Lottie metadata extraction. Kept separate from
 * `lottie-frame-provider` (which statically imports the dotlottie-web WASM
 * asset) so the import pipeline can read `w/h/fr/op` without dragging the WASM
 * into every module that touches media import.
 *
 * Handles both raw `.json` Lottie and `.lottie` dotLottie ZIP archives.
 */
import { unzipSync } from 'fflate'

/** Parsed intrinsic metadata for a Lottie animation. */
export interface LottieMetadata {
  width: number
  height: number
  frameRate: number
  totalFrames: number
  durationSeconds: number
}

/**
 * Extract intrinsic metadata from a raw Lottie JSON object/string.
 * Returns null when the payload isn't a recognizable Lottie.
 */
export function parseLottieMetadata(json: unknown): LottieMetadata | null {
  const data =
    typeof json === 'string'
      ? (() => {
          try {
            return JSON.parse(json) as Record<string, unknown>
          } catch {
            return null
          }
        })()
      : (json as Record<string, unknown> | null)
  if (!data || typeof data !== 'object') return null
  const w = data.w
  const h = data.h
  const fr = data.fr
  const ip = data.ip
  const op = data.op
  // A Lottie must carry these numeric fields; `layers` distinguishes it from
  // arbitrary JSON that happens to have w/h.
  if (
    typeof w !== 'number' ||
    typeof h !== 'number' ||
    typeof fr !== 'number' ||
    typeof op !== 'number' ||
    !Array.isArray(data.layers)
  ) {
    return null
  }
  const inPoint = typeof ip === 'number' ? ip : 0
  const totalFrames = Math.max(1, Math.round(op - inPoint))
  const frameRate = fr > 0 ? fr : 30
  return {
    width: Math.round(w),
    height: Math.round(h),
    frameRate,
    totalFrames,
    durationSeconds: totalFrames / frameRate,
  }
}

/** ZIP local-file-header magic: `PK\x03\x04`. */
function isZipArchive(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

/**
 * Read the first embedded animation's metadata from a `.lottie` (dotLottie ZIP).
 * dotLottie stores animations at `animations/<id>.json` and lists them in
 * `manifest.json`; we honor the manifest order when present, else fall back to
 * the first `animations/*.json` entry.
 */
function parseDotLottieArchive(bytes: Uint8Array): LottieMetadata | null {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    return null
  }

  const decoder = new TextDecoder()
  const animationEntries = Object.keys(files).filter((p) =>
    /(^|\/)animations\/[^/]+\.json$/i.test(p),
  )
  if (animationEntries.length === 0) return null

  // Prefer the manifest's first animation id so we probe the animation that
  // actually plays by default (matters for multi-animation archives).
  let orderedEntries = animationEntries
  const manifestKey = Object.keys(files).find((p) => /(^|\/)manifest\.json$/i.test(p))
  if (manifestKey) {
    try {
      const manifest = JSON.parse(decoder.decode(files[manifestKey]!)) as {
        animations?: Array<{ id?: string }>
      }
      const firstId = manifest.animations?.[0]?.id
      if (firstId) {
        // Plain string match (not a manifest-controlled RegExp) to avoid ReDoS
        // and regex-metacharacter mismatches on the id.
        const suffix = `animations/${firstId}.json`.toLowerCase()
        const preferred = animationEntries.find((p) => {
          const lower = p.toLowerCase()
          return lower === suffix || lower.endsWith(`/${suffix}`)
        })
        if (preferred)
          orderedEntries = [preferred, ...animationEntries.filter((p) => p !== preferred)]
      }
    } catch {
      // ignore a malformed manifest — fall back to entry order
    }
  }

  for (const entry of orderedEntries) {
    try {
      const meta = parseLottieMetadata(JSON.parse(decoder.decode(files[entry]!)))
      if (meta) return meta
    } catch {
      // try the next animation entry
    }
  }
  return null
}

/**
 * Extract Lottie metadata from raw file bytes, auto-detecting `.json` vs the
 * `.lottie` ZIP archive. Returns null when the bytes are not a valid Lottie.
 */
export function parseLottieFileBytes(bytes: Uint8Array): LottieMetadata | null {
  if (isZipArchive(bytes)) {
    return parseDotLottieArchive(bytes)
  }
  try {
    return parseLottieMetadata(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}
