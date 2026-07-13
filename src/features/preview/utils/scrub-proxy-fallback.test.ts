// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const mocks = vi.hoisted(() => ({
  cacheFallback: vi.fn(),
  getFallback: vi.fn(() => null),
  isSuperseded: vi.fn(() => false),
  noteProxy: vi.fn(),
  generateProxy: vi.fn(),
  cancelBackgroundProxy: vi.fn(),
  hasProxy: vi.fn(() => false),
  setProxyKey: vi.fn(),
  getMediaIdByUrl: vi.fn(() => 'media-1'),
  createImageBitmap: vi.fn(async () => ({ close: vi.fn(), width: 480, height: 270 })),
  filmstrip: {
    frames: [
      { timestamp: 1, url: 'blob:one', bitmap: { width: 480, height: 270 } },
      { timestamp: 2, url: 'blob:two', bitmap: { width: 480, height: 270 } },
    ],
    isComplete: true,
    isExtracting: false,
    progress: 1,
  },
}))

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: { getMediaIdByUrl: mocks.getMediaIdByUrl },
}))
vi.mock('../deps/media-library-contract', () => ({
  getSharedProxyKey: () => 'shared-key',
  importMediaLibraryService: vi.fn(),
  proxyService: {
    canGenerateProxy: () => true,
    setProxyKey: mocks.setProxyKey,
    hasProxy: mocks.hasProxy,
    getMediaIdByProxyUrl: vi.fn(() => null),
    generateProxy: mocks.generateProxy,
    cancelBackgroundProxy: mocks.cancelBackgroundProxy,
  },
  useMediaLibraryStore: {
    getState: () => ({
      mediaById: {
        'media-1': {
          id: 'media-1',
          mimeType: 'video/mp4',
          duration: 10,
          width: 1920,
          height: 1080,
          storageType: 'opfs',
          opfsPath: 'media/1/data',
        },
      },
      proxyStatus: new Map(),
    }),
  },
}))
vi.mock('../deps/timeline-filmstrip', () => ({
  importFilmstripCache: async () => ({
    filmstripCache: {
      prewarm: vi.fn(),
      getFromCacheSync: () => mocks.filmstrip,
      loadFromDisk: vi.fn(),
    },
  }),
}))
vi.mock('./decoder-prewarm', () => ({
  cacheActivePreviewFallbackBitmap: mocks.cacheFallback,
  getCachedActivePreviewFallbackBitmap: mocks.getFallback,
  isActivePreviewTargetSuperseded: mocks.isSuperseded,
  noteAutomaticScrubProxyRequest: mocks.noteProxy,
}))

import { disposeScrubProxyFallback, scheduleScrubProxyFallback } from './scrub-proxy-fallback'

beforeEach(() => {
  vi.clearAllMocks()
  disposeScrubProxyFallback()
  vi.stubGlobal('createImageBitmap', mocks.createImageBitmap)
})

describe('scrub proxy fallback', () => {
  it('queues a bounded background proxy and publishes the nearest cached filmstrip frame', async () => {
    scheduleScrubProxyFallback('blob:source', 2.1)

    await vi.waitFor(() => expect(mocks.cacheFallback).toHaveBeenCalledOnce())
    expect(mocks.generateProxy).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ kind: 'opfs', path: 'media/1/data' }),
      1920,
      1080,
      'shared-key',
      { priority: 'background' },
    )
    expect(mocks.cacheFallback).toHaveBeenCalledWith(
      'blob:source',
      2.1,
      2,
      expect.objectContaining({ width: 480, height: 270 }),
    )
  })

  it('does not publish a filmstrip frame that is too far from the requested timestamp', async () => {
    scheduleScrubProxyFallback('blob:source', 8)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.cacheFallback).not.toHaveBeenCalled()
  })
})
