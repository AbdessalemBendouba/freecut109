// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { renderVideoItem } from './video'
import type { ItemRenderContext, ItemTransform } from './types'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const transform: ItemTransform = {
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

const item = {
  id: 'clip-1',
  type: 'video',
  src: 'file.mp4',
  from: 0,
  durationInFrames: 30,
  sourceStart: 0,
  sourceFps: 30,
  sourceDuration: 30,
  speed: 1,
  transform,
} as VideoItem

function createCanvasContext(): OffscreenCanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as OffscreenCanvasRenderingContext2D
}

function createRenderContext(overrides: Partial<ItemRenderContext> = {}): ItemRenderContext {
  return {
    fps: 30,
    renderMode: 'preview',
    canvasSettings: { width: 1920, height: 1080, fps: 30 },
    videoExtractors: new Map(),
    videoElements: new Map(),
    useMediabunny: new Set(),
    mediabunnyDisabledItems: new Set(),
    mediabunnyFailureCountByItem: new Map(),
    scrubbingCache: null,
    ...overrides,
  } as unknown as ItemRenderContext
}

describe('renderVideoItem', () => {
  it('waits for cold MediaBunny only after every preview fallback misses', async () => {
    const ready = createDeferred<boolean>()
    const useMediabunny = new Set<string>()
    const drawFrame = vi.fn(async () => true)
    const extractor = {
      init: vi.fn(async () => true),
      drawFrame,
      drawFrameWithCapture: vi.fn(),
      captureFrame: vi.fn(),
      getLastFailureKind: vi.fn(() => 'none' as const),
      getDimensions: vi.fn(() => ({ width: 1920, height: 1080 })),
      getDuration: vi.fn(() => 1),
      prewarmBatch: vi.fn(async () => 0),
      isBatchPrewarmAvailable: vi.fn(() => true),
      dispose: vi.fn(),
    }
    const ensureVideoItemReady = vi.fn(async () => {
      const initialized = await ready.promise
      if (initialized) useMediabunny.add(item.id)
      return initialized
    })
    const renderContext = createRenderContext({
      videoExtractors: new Map([[item.id, extractor]]),
      useMediabunny,
      ensureVideoItemReady,
    } as Partial<ItemRenderContext>)

    const renderPromise = renderVideoItem(createCanvasContext(), item, transform, 0, renderContext)

    await expect(
      Promise.race([renderPromise.then(() => 'rendered'), Promise.resolve('waiting')]),
    ).resolves.toBe('waiting')

    ready.resolve(true)
    await renderPromise

    expect(ensureVideoItemReady).toHaveBeenCalledOnce()
    expect(drawFrame).toHaveBeenCalledOnce()
  })

  it('draws a cached worker bitmap without waiting for cold MediaBunny', async () => {
    const ready = createDeferred<boolean>()
    const ensureVideoItemReady = vi.fn(() => ready.promise)
    const bitmap = { width: 1920, height: 1080 } as ImageBitmap
    const ctx = createCanvasContext()
    const renderContext = createRenderContext({
      ensureVideoItemReady,
      getCachedPredecodedBitmap: vi.fn(() => bitmap),
    })

    const renderPromise = renderVideoItem(ctx, item, transform, 0, renderContext)

    await expect(
      Promise.race([renderPromise.then(() => 'rendered'), ready.promise.then(() => 'initialized')]),
    ).resolves.toBe('rendered')
    expect(ensureVideoItemReady).toHaveBeenCalledOnce()
    expect(ctx.drawImage).toHaveBeenCalled()

    ready.resolve(false)
  })
})
