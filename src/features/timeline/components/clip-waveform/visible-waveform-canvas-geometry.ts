export interface VisibleWaveformCanvasGeometry {
  left: number
  width: number
}

export function computeVisibleWaveformCanvasGeometry(
  width: number,
  visibleStartPx: number,
  visibleEndPx: number,
): VisibleWaveformCanvasGeometry {
  const safeWidth = Math.max(0, width)
  const left = Math.max(0, Math.min(safeWidth, Math.floor(visibleStartPx)))
  const right = Math.max(left, Math.min(safeWidth, Math.ceil(visibleEndPx)))

  return {
    left,
    width: Math.max(0, right - left),
  }
}
