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

describe('renderVideoItem', () => {
  it('does not wait for cold MediaBunny initialization during 1x preview playback', async () => {
    const ready = createDeferred<boolean>()
    const ensureVideoItemReady = vi.fn(() => ready.promise)
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
    const renderContext = {
      fps: 30,
      renderMode: 'preview',
      canvasSettings: { width: 1920, height: 1080, fps: 30 },
      videoExtractors: new Map(),
      videoElements: new Map(),
      useMediabunny: new Set(),
      mediabunnyDisabledItems: new Set(),
      mediabunnyFailureCountByItem: new Map(),
      scrubbingCache: null,
      ensureVideoItemReady,
    } as unknown as ItemRenderContext

    const renderPromise = renderVideoItem(
      {} as OffscreenCanvasRenderingContext2D,
      item,
      transform,
      0,
      renderContext,
    )

    await expect(
      Promise.race([renderPromise.then(() => 'rendered'), ready.promise.then(() => 'initialized')]),
    ).resolves.toBe('rendered')
    expect(ensureVideoItemReady).toHaveBeenCalledOnce()
    expect(ensureVideoItemReady).toHaveBeenCalledWith(item.id)

    ready.resolve(true)
  })
})
