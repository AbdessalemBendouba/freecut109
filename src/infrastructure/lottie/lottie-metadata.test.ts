import { describe, expect, it } from 'vite-plus/test'
import { parseLottieMetadata, parseLottieFileBytes } from './lottie-metadata'

function lottieJson(overrides: Record<string, unknown> = {}) {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 300,
    nm: 'test',
    layers: [{ ty: 4, nm: 'l', ip: 0, op: 60, ks: {} }],
    ...overrides,
  }
}

// Real `.lottie` (dotLottie ZIP) archives, generated with fflate in Node and
// embedded as base64. fflate's zipSync mis-encodes byte arrays under the vitest
// runner (module-realm Uint8Array mismatch), so fixtures are pre-built rather
// than zipped in-test; this also exercises the exact `unzipSync` path prod uses.
const FIXTURES = {
  // manifest -> anim0 (512x512), fr 30, op 60
  single:
    'UEsDBBQAAAAIAFVH5lxP03UzHgAAAB8AAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayiq5WykxRsgKLGSjVxtYCAFBLAwQUAAAACABVR+ZcrlJrjFMAAABxAAAAFQAAAGFuaW1hdGlvbnMvYW5pbTAuanNvbqtWKlOyUjLVM9czUNJRSitSsjI20FHKLFCyAlL5QMoMSJcrWZkaGukoZUDpvFygnhKg+pzEytSiYiWr6GqlkkolKxOoVA5QCs2IbKCq6tra2FoAUEsBAhQAFAAAAAgAVUfmXE/TdTMeAAAAHwAAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACABVR+ZcrlJrjFMAAABxAAAAFQAAAAAAAAAAAAAAAABJAAAAYW5pbWF0aW9ucy9hbmltMC5qc29uUEsFBgAAAAACAAIAfgAAAM8AAAAAAA==',
  // manifest lists [second, first]; second=999x640, first=100x100
  multi:
    'UEsDBBQAAAAIAFVH5lzUzjjJKwAAAC8AAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayiq5WykxRslIqTk3Oz0tRqtWB8tMyi4pLlGpjawFQSwMEFAAAAAgAVUfmXGd/2GRSAAAAcQAAABUAAABhbmltYXRpb25zL2ZpcnN0Lmpzb26rVipTslIy1TPXM1DSUUorUrIyNtBRyixQsgJS+UDKDEiXK1kZGgDpDCidlwvUUwJUn5NYmVpUrGQVXa1UUqlkZQKVygFKoRmRDVRVXVsbWwsAUEsDBBQAAAAIAFVH5lyqYAixVgAAAHEAAAAWAAAAYW5pbWF0aW9ucy9zZWNvbmQuanNvbqtWKlOyUjLVM9czUNJRSitSsjI20FHKLFCyAlL5QMoMSJcrWVlaWuooZQC5JkB+Xi5QTwlQfU5iZWpRsZJVdLVSSaWSlQlUKgcohWZENlBVdW1tbC0AUEsBAhQAFAAAAAgAVUfmXNTOOMkrAAAALwAAAA0AAAAAAAAAAAAAAAAAAAAAAG1hbmlmZXN0Lmpzb25QSwECFAAUAAAACABVR+ZcZ3/YZFIAAABxAAAAFQAAAAAAAAAAAAAAAABWAAAAYW5pbWF0aW9ucy9maXJzdC5qc29uUEsBAhQAFAAAAAgAVUfmXKpgCLFWAAAAcQAAABYAAAAAAAAAAAAAAAAA2wAAAGFuaW1hdGlvbnMvc2Vjb25kLmpzb25QSwUGAAAAAAMAAwDCAAAAZQEAAAAA',
  // no manifest; only.json=256x256
  noManifest:
    'UEsDBBQAAAAIAFVH5lxgXqjRUwAAAHEAAAAUAAAAYW5pbWF0aW9ucy9vbmx5Lmpzb26rVipTslIy1TPXM1DSUUorUrIyNtBRyixQsgJS+UDKDEiXK1kZmZrpKGVA6bxcoJ4SoPqcxMrUomIlq+hqpZJKJSsTqFQOUArNiGygqura2thaAFBLAQIUABQAAAAIAFVH5lxgXqjRUwAAAHEAAAAUAAAAAAAAAAAAAAAAAAAAAABhbmltYXRpb25zL29ubHkuanNvblBLBQYAAAAAAQABAEIAAACFAAAAAAA=',
  // manifest with empty animations, no animation files
  empty:
    'UEsDBBQAAAAIAFVH5lx1pkWvEwAAABEAAAANAAAAbWFuaWZlc3QuanNvbqtWSszLzE0syczPK1ayio6tBQBQSwECFAAUAAAACABVR+ZcdaZFrxMAAAARAAAADQAAAAAAAAAAAAAAAAAAAAAAbWFuaWZlc3QuanNvblBLBQYAAAAAAQABADsAAAA+AAAAAAA=',
}

const decodeB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

describe('parseLottieMetadata', () => {
  it('extracts w/h/fr and derives totalFrames + duration', () => {
    expect(parseLottieMetadata(lottieJson())).toEqual({
      width: 400,
      height: 300,
      frameRate: 30,
      totalFrames: 60,
      durationSeconds: 2,
    })
  })

  it('honors a non-zero in-point when computing totalFrames', () => {
    const meta = parseLottieMetadata(lottieJson({ ip: 15, op: 75 }))
    expect(meta?.totalFrames).toBe(60)
    expect(meta?.durationSeconds).toBe(2)
  })

  it('rejects JSON that lacks the Lottie shape (no layers array)', () => {
    expect(parseLottieMetadata({ w: 100, h: 100, fr: 30, op: 60 })).toBeNull()
  })

  it('rejects JSON missing required numeric fields', () => {
    expect(parseLottieMetadata({ w: 100, h: 100, layers: [] })).toBeNull()
  })
})

describe('parseLottieFileBytes', () => {
  it('parses raw .json Lottie bytes', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(lottieJson()))
    expect(parseLottieFileBytes(bytes)?.width).toBe(400)
  })

  it('parses a .lottie (dotLottie ZIP) archive', () => {
    expect(parseLottieFileBytes(decodeB64(FIXTURES.single))).toEqual({
      width: 512,
      height: 512,
      frameRate: 30,
      totalFrames: 60,
      durationSeconds: 2,
    })
  })

  it('probes the manifest-ordered animation in a multi-animation archive', () => {
    // manifest lists 'second' first -> expect its 999px width, not first's 100
    expect(parseLottieFileBytes(decodeB64(FIXTURES.multi))?.width).toBe(999)
  })

  it('falls back to the first animation entry when the manifest is absent', () => {
    expect(parseLottieFileBytes(decodeB64(FIXTURES.noManifest))?.width).toBe(256)
  })

  it('returns null for a ZIP with no animations', () => {
    expect(parseLottieFileBytes(decodeB64(FIXTURES.empty))).toBeNull()
  })

  it('returns null for non-Lottie bytes', () => {
    expect(parseLottieFileBytes(new TextEncoder().encode('not json at all'))).toBeNull()
    expect(parseLottieFileBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  })
})
