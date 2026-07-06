/**
 * Lottie frame rendering via @lottiefiles/dotlottie-web.
 *
 * dotlottie-web's WASM core renders a specific frame synchronously with
 * `setFrame()` (verified frame-accurate + deterministic), which is exactly what
 * FreeCut's frame-by-frame compositor needs. Unlike the GIF path we do NOT
 * pre-extract every frame — dotlottie renders on demand into a canvas, so this
 * module just owns:
 *   - one-time WASM URL wiring (bundled asset, works offline / in the export worker)
 *   - timeline-frame -> lottie-frame mapping (shared by preview + export)
 *   - an export-side renderer that draws a requested frame into an OffscreenCanvas
 *
 * Preview uses {@link LottieRenderer} directly against a visible canvas.
 */
import { DotLottie } from '@lottiefiles/dotlottie-web'
// Bundle the WASM alongside the app so it resolves without the default CDN.
// Use the package's `exports`-mapped subpath (NOT `/dist/...`) so Node's strict
// exports resolution (Vitest) can resolve it too, not just Vite.
import wasmUrl from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url'
import { createLogger } from '@/shared/logging/logger'

// Metadata parsing is WASM-free; re-exported here for convenience.
export { parseLottieMetadata, parseLottieFileBytes, type LottieMetadata } from './lottie-metadata'

const log = createLogger('lottie-provider')

let wasmConfigured = false

/** Point dotlottie at the bundled WASM (idempotent). Call before any DotLottie. */
export function ensureLottieWasm(): void {
  if (wasmConfigured) return
  DotLottie.setWasmUrl(wasmUrl)
  wasmConfigured = true
}

export interface LottieFrameMapInput {
  /** Frame within the clip (0-based), in project FPS. */
  localFrame: number
  /** Project frames per second. */
  projectFps: number
  /** Playback speed multiplier (default 1). */
  speed: number
  /** Total frames reported by the Lottie animation. */
  totalFrames: number
  /** Native frame rate of the Lottie animation. */
  frameRate: number
  /** Whether to loop when the clip outlives the animation. */
  loop: boolean
}

/**
 * Map a clip-local timeline frame to a Lottie frame index.
 * Clamped to `[0, totalFrames - 1]` — dotlottie's valid seek range.
 */
export function mapTimelineFrameToLottieFrame({
  localFrame,
  projectFps,
  speed,
  totalFrames,
  frameRate,
  loop,
}: LottieFrameMapInput): number {
  if (totalFrames <= 0 || projectFps <= 0 || frameRate <= 0) return 0
  const seconds = (localFrame / projectFps) * (speed || 1)
  let lottieFrame = seconds * frameRate
  const maxFrame = totalFrames - 1
  if (loop) {
    lottieFrame = ((lottieFrame % totalFrames) + totalFrames) % totalFrames
  }
  return Math.max(0, Math.min(lottieFrame, maxFrame))
}

/**
 * A single Lottie animation bound to a canvas, seekable frame-by-frame.
 * Rendering is synchronous once {@link ready} resolves.
 */
export class LottieRenderer {
  private readonly dotLottie: DotLottie
  private readonly _canvas: HTMLCanvasElement | OffscreenCanvas
  private _ready: Promise<void>
  private _loaded = false
  private _destroyed = false

  constructor(config: {
    canvas: HTMLCanvasElement | OffscreenCanvas
    /** Blob/URL to the animation file. */
    src?: string
    /** Raw animation JSON string. */
    data?: string
    /**
     * Track the canvas's display size and re-render crisply on resize. Enable
     * for a visible preview canvas; leave off (default) for a fixed-size
     * OffscreenCanvas (export), which has no client size to observe.
     */
    autoResize?: boolean
  }) {
    ensureLottieWasm()
    this._canvas = config.canvas
    const autoResize = config.autoResize ?? false
    this.dotLottie = new DotLottie({
      canvas: config.canvas,
      src: config.src,
      data: config.data,
      autoplay: false,
      loop: false,
      backgroundColor: '#00000000',
      renderConfig: {
        // dpr matters only for a display canvas; keep export deterministic at 1.
        devicePixelRatio: autoResize ? undefined : 1,
        autoResize,
        freezeOnOffscreen: false,
      },
    })

    this._ready = new Promise<void>((resolve) => {
      const onLoad = () => {
        this._loaded = true
        resolve()
      }
      // Guard against a load that already completed synchronously.
      if (this.dotLottie.isLoaded) {
        onLoad()
        return
      }
      this.dotLottie.addEventListener('load', onLoad)
      this.dotLottie.addEventListener('loadError', () => {
        log.warn('lottie load failed', { src: config.src })
        resolve() // resolve so callers don't hang; renders no-op
      })
    })
  }

  get ready(): Promise<void> {
    return this._ready
  }

  get isLoaded(): boolean {
    return this._loaded
  }

  get canvas(): HTMLCanvasElement | OffscreenCanvas {
    return this._canvas
  }

  get totalFrames(): number {
    return this.dotLottie.totalFrames || 1
  }

  /** Seconds for one full playthrough at native speed. */
  get duration(): number {
    return this.dotLottie.duration || this.totalFrames / 30
  }

  get frameRate(): number {
    const d = this.duration
    return d > 0 ? this.totalFrames / d : 30
  }

  /** Render a specific Lottie frame synchronously into the bound canvas. */
  renderFrame(lottieFrame: number): void {
    if (this._destroyed || !this._loaded) return
    this.dotLottie.setFrame(lottieFrame)
  }

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    try {
      this.dotLottie.destroy()
    } catch {
      // ignore teardown races
    }
  }
}

/**
 * Render a representative frame of a Lottie to a PNG blob for use as a media
 * thumbnail. Returns null if the animation can't load. Main-thread only
 * (uses OffscreenCanvas + the software renderer).
 */
export async function renderLottieThumbnail(
  src: string,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
  const renderer = new LottieRenderer({ canvas, src })
  try {
    await renderer.ready
    if (!renderer.isLoaded) return null
    // A frame ~40% in is usually more representative than the first frame.
    renderer.renderFrame(Math.floor(renderer.totalFrames * 0.4))
    return await canvas.convertToBlob({ type: 'image/png' })
  } catch {
    return null
  } finally {
    renderer.destroy()
  }
}

/**
 * Export-side manager: owns one OffscreenCanvas-backed {@link LottieRenderer}
 * per source, preloaded before the frame loop. Keyed by the item's `src`.
 */
export class LottieExportProvider {
  private readonly renderers = new Map<string, LottieRenderer>()

  /** Warm a renderer for a source at a target size. Safe to call repeatedly. */
  async preload(key: string, src: string, width: number, height: number): Promise<void> {
    if (this.renderers.has(key)) return
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
    const renderer = new LottieRenderer({ canvas, src })
    this.renderers.set(key, renderer)
    await renderer.ready
  }

  /** Render `lottieFrame` and return the OffscreenCanvas to composite, or null. */
  renderFrame(key: string, lottieFrame: number): OffscreenCanvas | null {
    const renderer = this.renderers.get(key)
    if (!renderer || !renderer.isLoaded) return null
    renderer.renderFrame(lottieFrame)
    return renderer.canvas as OffscreenCanvas
  }

  get(key: string): LottieRenderer | undefined {
    return this.renderers.get(key)
  }

  destroy(): void {
    for (const r of this.renderers.values()) r.destroy()
    this.renderers.clear()
  }
}
