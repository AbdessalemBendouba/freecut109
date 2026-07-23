import { memo, useEffect, useRef } from 'react'

import { computeVisibleWaveformCanvasGeometry } from './visible-waveform-canvas-geometry'

interface VisibleWaveformCanvasProps {
  /** Total logical width of the clip waveform. */
  width: number
  height: number
  /** Visible logical pixel range within the clip. */
  visibleStartPx: number
  visibleEndPx: number
  /**
   * Changes when the viewport ratios change. Unlike the pixel range, this stays
   * stable while zoom geometry is changing, so zoom redraws remain throttled by
   * `version`.
   */
  viewportVersion: string
  /** Throttled content/zoom version. */
  version: string | number
  renderWindow: (
    ctx: CanvasRenderingContext2D,
    windowOffsetPx: number,
    windowWidthPx: number,
  ) => void
}

/**
 * A single viewport-bounded waveform canvas.
 *
 * The element's CSS size and backing bitmap are committed together. In
 * particular, width changes never stretch an older bitmap while a zoom redraw
 * is waiting for its cadence-limited commit.
 */
export const VisibleWaveformCanvas = memo(function VisibleWaveformCanvas({
  width,
  height,
  visibleStartPx,
  visibleEndPx,
  viewportVersion,
  version,
  renderWindow,
}: VisibleWaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latestGeometryRef = useRef({ width, visibleStartPx, visibleEndPx })
  latestGeometryRef.current = { width, visibleStartPx, visibleEndPx }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const latest = latestGeometryRef.current
    const geometry = computeVisibleWaveformCanvasGeometry(
      latest.width,
      latest.visibleStartPx,
      latest.visibleEndPx,
    )
    if (geometry.width <= 0 || height <= 0) {
      canvas.style.display = 'none'
      return
    }

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const backingWidth = Math.max(1, Math.ceil(geometry.width * dpr))
    const backingHeight = Math.max(1, Math.ceil(height * dpr))

    // Commit layout and backing dimensions in the same effect. Never mutate
    // only the CSS width: that would resample and blur the previous bitmap.
    canvas.style.display = 'block'
    canvas.style.left = `${geometry.left}px`
    canvas.style.width = `${geometry.width}px`
    canvas.style.height = `${height}px`
    canvas.width = backingWidth
    canvas.height = backingHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, geometry.width, height)
    renderWindow(ctx, geometry.left, geometry.width)
  }, [height, renderWindow, version, viewportVersion])

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 pointer-events-none"
      aria-hidden="true"
    />
  )
})
