// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  backgroundPreseek,
  disposePrewarmWorker,
  warmDecoderPrewarmWorkerPool,
} from './decoder-prewarm'
import {
  clearObjectUrlRegistry,
  registerObjectUrl,
} from '@/infrastructure/browser/object-url-registry'

type MockWorkerMessage = {
  type: string
  id?: string
  timestamp?: number
  blob?: Blob
  src?: string
  sourceMetadata?: {
    storageType: 'opfs'
    opfsPath: string
    fileSize?: number
  }
}

class MockWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly addEventListener = vi.fn()
  readonly terminate = vi.fn()
  readonly postMessage = vi.fn((message: MockWorkerMessage) => {
    if (message.type !== 'preseek' || !autoRespondPreseek) {
      return
    }

    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'preseek_done',
          id: message.id,
          success: true,
          timestamp: message.timestamp,
          bitmap: mockBitmap,
        },
      } as MessageEvent)
    })
  })
}

let createdWorkers: MockWorker[] = []
let fetchMock: ReturnType<typeof vi.fn>
let mockBitmap: ImageBitmap
let autoRespondPreseek = true

beforeEach(() => {
  createdWorkers = []
  mockBitmap = { close: vi.fn() } as unknown as ImageBitmap
  fetchMock = vi.fn()
  autoRespondPreseek = true

  vi.stubGlobal('fetch', fetchMock)
  class WorkerStub extends MockWorker {
    constructor() {
      super()
      createdWorkers.push(this)
    }
  }

  vi.stubGlobal('Worker', WorkerStub as unknown as typeof Worker)
})

afterEach(() => {
  disposePrewarmWorker()
  clearObjectUrlRegistry()
  vi.unstubAllGlobals()
})

describe('decoder prewarm', () => {
  it('uses registered object URL blobs without re-fetching them', async () => {
    const blob = new Blob(['video'])
    registerObjectUrl('blob:clip-1', blob)

    const bitmap = await backgroundPreseek('blob:clip-1', 1)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(1)
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-1',
      timestamp: 1,
      blob,
    })
    expect(bitmap).toBe(mockBitmap)
  })

  it('prefers direct OPFS metadata over cloning blobs into the worker', async () => {
    const blob = new Blob(['video'])
    registerObjectUrl('blob:clip-opfs', blob, {
      storageType: 'opfs',
      opfsPath: 'content/aa/bb/data',
      fileSize: blob.size,
    })

    const bitmap = await backgroundPreseek('blob:clip-opfs', 2)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(1)
    expect(preseekPosts[0]).toMatchObject({
      type: 'preseek',
      src: 'blob:clip-opfs',
      timestamp: 2,
      sourceMetadata: {
        storageType: 'opfs',
        opfsPath: 'content/aa/bb/data',
        fileSize: blob.size,
      },
    })
    expect(preseekPosts[0]?.blob).toBeUndefined()
    expect(bitmap).toBe(mockBitmap)
  })

  it('fails fast for unregistered blob URLs without ever calling fetch', async () => {
    // Any blob: URL that isn't in the object-url registry is, by
    // construction, unreachable from our JS — `blobUrlManager` is the
    // only place we create blob URLs, and it always registers. Calling
    // fetch() in that case would produce an uncatchable ERR_FILE_NOT_FOUND
    // in the DevTools console (Chrome logs network errors before the JS
    // .catch runs). The module now bails silently instead.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const firstResult = await backgroundPreseek('blob:stale', 1)
    const secondResult = await backgroundPreseek('blob:stale', 2)
    const preseekPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')

    expect(firstResult).toBeNull()
    expect(secondResult).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(preseekPosts).toHaveLength(0)
  })
  it('warmDecoderPrewarmWorkerPool eagerly spawns the pool exactly once', () => {
    warmDecoderPrewarmWorkerPool()

    expect(createdWorkers.length).toBeGreaterThan(0)
    for (const worker of createdWorkers) {
      // Each worker preloads mediabunny WASM on creation.
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'warmup' })
    }

    const spawnedCount = createdWorkers.length
    warmDecoderPrewarmWorkerPool()
    expect(createdWorkers.length).toBe(spawnedCount)
  })

  it('runs a queued speculative preseek when a saturated worker becomes free', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const poolSize = createdWorkers.length
    expect(poolSize).toBeGreaterThan(0)

    const inflightPromises: ReturnType<typeof backgroundPreseek>[] = []
    for (let index = 0; index < poolSize; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      inflightPromises.push(backgroundPreseek(src, index))
    }

    // A duplicate request for an already-inflight src/timestamp needs no extra
    // worker capacity — even with the pool saturated it must reuse the promise.
    const duplicateResult = backgroundPreseek('blob:busy-0', 0)
    expect(duplicateResult).toBe(inflightPromises[0])

    registerObjectUrl('blob:overflow', new Blob(['overflow']))
    const overflowResult = backgroundPreseek('blob:overflow', 999)
    const duplicateOverflowResult = backgroundPreseek('blob:overflow', 999)
    expect(duplicateOverflowResult).toBe(overflowResult)

    const initialPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek')
    expect(initialPosts).toHaveLength(poolSize)

    createdWorkers[0]!.onmessage?.({
      data: { type: 'preseek_done', id: initialPosts[0]!.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await vi.waitFor(() => {
      const queuedPost = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .find((message) => message.type === 'preseek' && message.src === 'blob:overflow')
      expect(queuedPost).toBeDefined()
    })

    const queuedWorker = createdWorkers.find((worker) =>
      worker.postMessage.mock.calls.some(
        ([message]) =>
          (message as MockWorkerMessage).type === 'preseek' &&
          (message as MockWorkerMessage).src === 'blob:overflow',
      ),
    )!
    const queuedPost = queuedWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'preseek' && message.src === 'blob:overflow')!
    queuedWorker.onmessage?.({
      data: { type: 'preseek_done', id: queuedPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await expect(overflowResult).resolves.toBe(mockBitmap)
    const overflowPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek' && message.src === 'blob:overflow')
    expect(overflowPosts).toHaveLength(1)
  })

  it('forwards superseded same-source waiters to the latest decode', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    for (let index = 0; index < createdWorkers.length; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      void backgroundPreseek(src, index)
    }

    registerObjectUrl('blob:latest', new Blob(['latest']))
    const stale = backgroundPreseek('blob:latest', 10)
    const duplicateStale = backgroundPreseek('blob:latest', 10)
    expect(duplicateStale).toBe(stale)
    const latest = backgroundPreseek('blob:latest', 11)

    const busyPost = createdWorkers[0]!.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'preseek')!
    createdWorkers[0]!.onmessage?.({
      data: { type: 'preseek_done', id: busyPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await vi.waitFor(() => {
      const latestPosts = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'preseek' && message.src === 'blob:latest')
      expect(latestPosts.map((message) => message.timestamp)).toEqual([11])
    })

    const latestWorker = createdWorkers.find((worker) =>
      worker.postMessage.mock.calls.some(
        ([message]) => (message as MockWorkerMessage).src === 'blob:latest',
      ),
    )!
    const latestPost = latestWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.src === 'blob:latest')!
    latestWorker.onmessage?.({
      data: { type: 'preseek_done', id: latestPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await expect(Promise.all([stale, duplicateStale, latest])).resolves.toEqual([
      mockBitmap,
      mockBitmap,
      mockBitmap,
    ])
  })
  it('forwards a supersession chain to a synchronously retried target', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    for (let index = 0; index < createdWorkers.length; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      void backgroundPreseek(src, index)
    }

    registerObjectUrl('blob:retry', new Blob(['retry']))
    const stale = backgroundPreseek('blob:retry', 10)
    const newer = backgroundPreseek('blob:retry', 11)
    const retry = backgroundPreseek('blob:retry', 10)
    expect(retry).not.toBe(stale)

    const busyPost = createdWorkers[0]!.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.type === 'preseek')!
    createdWorkers[0]!.onmessage?.({
      data: { type: 'preseek_done', id: busyPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await vi.waitFor(() => {
      const retryPosts = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'preseek' && message.src === 'blob:retry')
      expect(retryPosts.map((message) => message.timestamp)).toEqual([10])
    })

    const retryWorker = createdWorkers.find((worker) =>
      worker.postMessage.mock.calls.some(
        ([message]) => (message as MockWorkerMessage).src === 'blob:retry',
      ),
    )!
    const retryPost = retryWorker.postMessage.mock.calls
      .map(([message]) => message as MockWorkerMessage)
      .find((message) => message.src === 'blob:retry')!
    retryWorker.onmessage?.({
      data: { type: 'preseek_done', id: retryPost.id, success: true, bitmap: mockBitmap },
    } as MessageEvent)

    await expect(Promise.all([stale, newer, retry])).resolves.toEqual([
      mockBitmap,
      mockBitmap,
      mockBitmap,
    ])
  })
  it('evicts the oldest sources when the bounded waiting queue is full', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const poolSize = createdWorkers.length
    for (let index = 0; index < poolSize; index += 1) {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      void backgroundPreseek(src, index)
    }

    const queued = Array.from({ length: poolSize + 2 }, (_, index) => {
      const src = `blob:queued-${index}`
      registerObjectUrl(src, new Blob([`queued-${index}`]))
      return { src, promise: backgroundPreseek(src, index + 100) }
    })
    await expect(queued[0]!.promise).resolves.toBeNull()
    await expect(queued[1]!.promise).resolves.toBeNull()

    const busyPosts = createdWorkers
      .flatMap((worker) => worker.postMessage.mock.calls)
      .map(([message]) => message as MockWorkerMessage)
      .filter((message) => message.type === 'preseek' && message.src?.startsWith('blob:busy-'))
    for (let index = 0; index < poolSize; index += 1) {
      createdWorkers[index]!.onmessage?.({
        data: {
          type: 'preseek_done',
          id: busyPosts[index]!.id,
          success: true,
          bitmap: mockBitmap,
        },
      } as MessageEvent)
    }

    await vi.waitFor(() => {
      const queuedPosts = createdWorkers
        .flatMap((worker) => worker.postMessage.mock.calls)
        .map(([message]) => message as MockWorkerMessage)
        .filter((message) => message.type === 'preseek' && message.src?.startsWith('blob:queued-'))
      expect(queuedPosts.map((message) => message.src)).toEqual(
        queued.slice(2).map(({ src }) => src),
      )
    })
  })

  it('clears active and queued requests on disposal before a clean restart', async () => {
    autoRespondPreseek = false
    warmDecoderPrewarmWorkerPool()

    const oldWorkers = [...createdWorkers]
    const active = oldWorkers.map((_, index) => {
      const src = `blob:busy-${index}`
      registerObjectUrl(src, new Blob([`video-${index}`]))
      return backgroundPreseek(src, index)
    })
    registerObjectUrl('blob:restart', new Blob(['restart']))
    const queued = backgroundPreseek('blob:restart', 5)

    disposePrewarmWorker()

    await expect(queued).resolves.toBeNull()
    await expect(Promise.all(active)).resolves.toEqual(oldWorkers.map(() => null))
    for (const worker of oldWorkers) {
      expect(worker.terminate).toHaveBeenCalledOnce()
      expect(
        worker.postMessage.mock.calls.some(
          ([message]) => (message as MockWorkerMessage).src === 'blob:restart',
        ),
      ).toBe(false)
    }

    autoRespondPreseek = true
    const oldWorkerCount = createdWorkers.length
    warmDecoderPrewarmWorkerPool()
    await expect(backgroundPreseek('blob:restart', 5)).resolves.toBe(mockBitmap)
    const restartedWorkers = createdWorkers.slice(oldWorkerCount)
    expect(
      restartedWorkers.some((worker) =>
        worker.postMessage.mock.calls.some(
          ([message]) => (message as MockWorkerMessage).src === 'blob:restart',
        ),
      ),
    ).toBe(true)
  })

  it('closes bitmaps from late worker replies after a request is no longer pending', () => {
    warmDecoderPrewarmWorkerPool()

    const worker = createdWorkers[0]!
    worker.onmessage?.({
      data: {
        type: 'preseek_done',
        id: 'missing-request',
        success: true,
        bitmap: mockBitmap,
      },
    } as MessageEvent)

    expect(mockBitmap.close).toHaveBeenCalledTimes(1)
  })
})
