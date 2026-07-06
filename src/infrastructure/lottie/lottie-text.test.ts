import { describe, expect, it } from 'vite-plus/test'
import { extractLottieTextLayers, applyLottieTextOverrides } from './lottie-text'

// Minimal Lottie with two text layers (ty:5) and one shape layer (ty:4).
function animation() {
  return {
    v: '5.7.0',
    w: 100,
    h: 100,
    fr: 30,
    ip: 0,
    op: 60,
    layers: [
      { ty: 4, nm: 'Shape' },
      { ty: 5, nm: 'Title', t: { d: { k: [{ s: { t: 'Hello' } }] } } },
      { ty: 5, t: { d: { k: [{ s: { t: 'Subtitle' } }] } } },
    ],
  }
}

describe('extractLottieTextLayers', () => {
  it('returns text layers with stable keys and labels, skipping non-text layers', () => {
    expect(extractLottieTextLayers(animation())).toEqual([
      { key: '1', text: 'Hello', label: 'Title' },
      { key: '2', text: 'Subtitle', label: 'Text 3' },
    ])
  })

  it('accepts a JSON string and returns [] for non-Lottie input', () => {
    expect(extractLottieTextLayers(JSON.stringify(animation()))).toHaveLength(2)
    expect(extractLottieTextLayers('not json')).toEqual([])
    expect(extractLottieTextLayers({ foo: 'bar' })).toEqual([])
  })
})

describe('applyLottieTextOverrides', () => {
  it('patches only the addressed text layer and preserves others', () => {
    const patched = applyLottieTextOverrides(animation(), { '1': 'Goodbye' })
    expect(patched).not.toBeNull()
    const parsed = JSON.parse(patched!)
    expect(parsed.layers[1].t.d.k[0].s.t).toBe('Goodbye')
    expect(parsed.layers[2].t.d.k[0].s.t).toBe('Subtitle')
  })

  it('returns null when there is nothing to change', () => {
    expect(applyLottieTextOverrides(animation(), {})).toBeNull()
    // Unknown key → no change.
    expect(applyLottieTextOverrides(animation(), { '99': 'x' })).toBeNull()
    // Non-text layer index → no change.
    expect(applyLottieTextOverrides(animation(), { '0': 'x' })).toBeNull()
  })
})
