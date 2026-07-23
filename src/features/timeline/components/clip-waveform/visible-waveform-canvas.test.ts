import { describe, expect, it } from 'vite-plus/test'

import { computeVisibleWaveformCanvasGeometry } from './visible-waveform-canvas-geometry'

describe('computeVisibleWaveformCanvasGeometry', () => {
  it('creates a whole-pixel canvas for only the visible clip window', () => {
    expect(computeVisibleWaveformCanvasGeometry(100_000, 49_999.4, 51_920.2)).toEqual({
      left: 49_999,
      width: 1_922,
    })
  })

  it('clamps the canvas to the clip without expanding to the full duration', () => {
    expect(computeVisibleWaveformCanvasGeometry(2_000, -20, 2_040)).toEqual({
      left: 0,
      width: 2_000,
    })
    expect(computeVisibleWaveformCanvasGeometry(2_000, 2_100, 2_200)).toEqual({
      left: 2_000,
      width: 0,
    })
  })
})
