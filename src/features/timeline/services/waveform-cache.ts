/**
 * Waveform Cache Service
 *
 * Low-Memory optimized waveform data caching for 32-bit legacy systems.
 */

import { createLogger } from '@/shared/logging/logger'
import { createManagedWorker } from '@/shared/utils/managed-worker'
import {
  getObjectUrlBlob,
  getObjectUrlDirectFileMetadata,
} from '@/infrastructure/browser/object-url-registry'
import {
  waveformOPFSStorage,
  WAVEFORM_LEVELS,
  chooseLevelForZoom,
  type MultiResolutionWaveform,
} from './waveform-opfs-storage'
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache'
import type { WaveformWorkerResponse } from './waveform-worker'
import type { WaveformBin } from '@/types/storage'
import {
  getWaveform as getLegacyWaveformFromIndexedDB,
  getWaveformRecord as getWaveformRecordFromIndexedDB,
  getWaveformMeta as getWaveformMetaFromIndexedDB,
  getWaveformBins as getWaveformBinsFromIndexedDB,
  saveWaveformBin as saveWaveformBinToIndexedDB,
  saveWaveformMeta as saveWaveformMetaToIndexedDB,
  deleteWaveform as deleteWaveformFromIndexedDB,
} from '@/infrastructure/storage'

const logger = createLogger('WaveformCache')

// Reduced cache budgets to protect 512MB 32-bit V8 heap
const MAX_CACHE_SIZE_BYTES = 32 * 1024 * 1024 // 32MB max
const MAX_LEVEL_CACHE_SIZE_BYTES = 16 * 1024 * 1024 // 16MB max
const MAX_CONCURRENT_WAVEFORM_GENERATIONS = 1
const WAVEFORM_PROGRESS_NOTIFY_INTERVAL_MS = 120
const WAVEFORM_PROGRESS_NOTIFY_STEP = 2
const WAVEFORM_NOTIFY_INTERVAL_MS = 180

const SAMPLES_PER_SECOND: number = WAVEFORM_LEVELS[0] // 500 samples/sec
const WAVEFORM_OVERVIEW_SAMPLES_PER_SECOND: number = WAVEFORM_LEVELS[WAVEFORM_LEVELS.length - 1]! // 10 samples/sec
const WAVEFORM_VISIBLE_RANGE_MAX_SAMPLES_PER_SECOND = 100
const WAVEFORM_BIN_DURATION_SEC = 30
const WAVEFORM_BIN_SAMPLES = SAMPLES_PER_SECOND * WAVEFORM_BIN_DURATION_SEC

export interface CachedWaveform {
  peaks: Float32Array
  duration: number
  sampleRate: number
  channels: number
  stereo: boolean
  maxPeak: number
  loadedSamples: number
  sizeBytes: number
  lastAccessed: number
  isComplete: boolean
}

export interface CachedWaveformLevel {
  peaks: Float32Array
  sampleRate: number
  channels: number
  stereo: boolean
  duration: number
  maxPeak: number
  loadedSamples: number
  sizeBytes: number
  lastAccessed: number
}

class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

interface PendingRequest {
  promise: Promise<CachedWaveform>
  requestId: string
  status: 'queued' | 'running'
  reject: (error: Error) => void
}

interface QueuedGeneration {
  mediaId: string
  blobUrl: string
  requestId: string
  onProgress?: (progress: number) => void
  resolve: (waveform: CachedWaveform) => void
  reject: (error: Error) => void
}

type WaveformUpdateCallback = (waveform: CachedWaveform) => void

interface WaveformGenerationOptions {
  samplesPerSecond?: number
  persistBins?: boolean
  persistOPFS?: boolean
  timeoutMs?: number
  startTimeSec?: number
  endTimeSec?: number
  updateMemoryCache?: boolean
  isComplete?: boolean
}

class WaveformCacheService {
  private memoryCache = new SizedAccessedMemoryCache<CachedWaveform>(MAX_CACHE_SIZE_BYTES)
  private levelCache = new SizedAccessedMemoryCache<CachedWaveformLevel>(MAX_LEVEL_CACHE_SIZE_BYTES)
  private pendingLevelRequests = new Map<string, Promise<CachedWaveformLevel | null>>()
  private pendingRangeRequests = new Map<string, Promise<CachedWaveform | null>>()
  private levelMediaGeneration = new Map<string, number>()
  private levelGlobalGeneration = 0
  private pendingRequests = new Map<string, PendingRequest>()
  private updateCallbacks = new Map<string, Set<WaveformUpdateCallback>>()
  private workerRequestId = 0
  private generationQueue: QueuedGeneration[] = []
  private activeGenerations = new Set<string>()
  private workerRejectors = new Map<string, (error: Error) => void>()
  private fallbackAbortControllers = new Map<string, AbortController>()
  private readonly workerManager = createManagedWorker({
    createWorker: () =>
      new Worker(new URL('./waveform-worker.ts', import.meta.url), { type: 'module' }),
  })

  private getWorker(): Worker {
    return this.workerManager.getWorker()
  }

  private enqueueGeneration(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void,
  ): Promise<CachedWaveform> {
    const requestId = `waveform-${++this.workerRequestId}`

    let resolvePromise!: (waveform: CachedWaveform) => void
    let rejectPromise!: (error: Error) => void
    const promise = new Promise<CachedWaveform>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    this.pendingRequests.set(mediaId, {
      promise,
      requestId,
      status: 'queued',
      reject: rejectPromise,
    })

    this.generationQueue.push({
      mediaId,
      blobUrl,
      requestId,
      onProgress,
      resolve: resolvePromise,
      reject: rejectPromise,
    })

    this.processGenerationQueue()
    return promise
  }

  private processGenerationQueue(): void {
    while (
      this.activeGenerations.size < MAX_CONCURRENT_WAVEFORM_GENERATIONS &&
      this.generationQueue.length > 0
    ) {
      const queued = this.generationQueue.shift()
      if (!queued) return

      const pending = this.pendingRequests.get(queued.mediaId)
      if (!pending || pending.requestId !== queued.requestId) {
        queued.reject(new Error('Superseded'))
        continue
      }

      pending.status = 'running'
      this.activeGenerations.add(queued.mediaId)
      void this.startQueuedGeneration(queued)
    }
  }

  private async startQueuedGeneration(queued: QueuedGeneration): Promise<void> {
    try {
      const waveform = await this.generateWaveform(
        queued.mediaId,
        queued.blobUrl,
        queued.requestId,
        queued.onProgress,
      )
      queued.resolve(waveform)
    } catch (error) {
      queued.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      const pending = this.pendingRequests.get(queued.mediaId)
      const isStale = pending && pending.requestId !== queued.requestId
      if (!isStale) {
        this.activeGenerations.delete(queued.mediaId)
        this.pendingRequests.delete(queued.mediaId)
      }
      this.processGenerationQueue()
    }
  }

  subscribe(mediaId: string, callback: WaveformUpdateCallback): () => void {
    if (!this.updateCallbacks.has(mediaId)) {
      this.updateCallbacks.set(mediaId, new Set())
    }
    this.updateCallbacks.get(mediaId)!.add(callback)
    return () => {
      const callbacks = this.updateCallbacks.get(mediaId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.updateCallbacks.delete(mediaId)
        }
      }
    }
  }

  private notifyUpdate(mediaId: string, waveform: CachedWaveform): void {
    const callbacks = this.updateCallbacks.get(mediaId)
    if (callbacks) {
      for (const callback of callbacks) {
        callback(waveform)
      }
    }
  }

  private getFromMemoryCache(mediaId: string): CachedWaveform | null {
    return this.memoryCache.get(mediaId)
  }

  getFromMemoryCacheSync(mediaId: string): CachedWaveform | null {
    return this.getFromMemoryCache(mediaId)
  }

  hasPendingGeneration(mediaId: string): boolean {
    return this.pendingRequests.has(mediaId)
  }

  private addToMemoryCache(mediaId: string, data: CachedWaveform): void {
    this.memoryCache.add(mediaId, data)
  }

  private levelCacheKey(mediaId: string, levelIndex: number): string {
    return `${mediaId}:${levelIndex}`
  }

  private currentLevelToken(mediaId: string): string {
    return `${this.levelGlobalGeneration}:${this.levelMediaGeneration.get(mediaId) ?? 0}`
  }

  getDisplayLevelSync(mediaId: string, levelIndex: number): CachedWaveformLevel | null {
    return this.levelCache.get(this.levelCacheKey(mediaId, levelIndex))
  }

  async getDisplayLevel(mediaId: string, levelIndex: number): Promise<CachedWaveformLevel | null> {
    const key = this.levelCacheKey(mediaId, levelIndex)
    const cached = this.levelCache.get(key)
    if (cached) return cached

    const inFlight = this.pendingLevelRequests.get(key)
    if (inFlight) return inFlight

    const tokenAtStart = this.currentLevelToken(mediaId)
    const request = (async (): Promise<CachedWaveformLevel | null> => {
      const level = await waveformOPFSStorage.getLevel(mediaId, levelIndex)
      if (!level) return null

      if (this.currentLevelToken(mediaId) !== tokenAtStart) return null

      const floatsPerSample = level.channels >= 2 ? 2 : 1
      const sampleCount = level.peaks.length / floatsPerSample
      const result: CachedWaveformLevel = {
        peaks: level.peaks,
        sampleRate: level.sampleRate,
        channels: level.channels,
        stereo: level.channels >= 2,
        duration: level.sampleRate > 0 ? sampleCount / level.sampleRate : 0,
        maxPeak: this.computeMaxPeak(level.peaks),
        loadedSamples: level.peaks.length,
        sizeBytes: level.peaks.byteLength,
        lastAccessed: Date.now(),
      }
      this.levelCache.add(key, result)
      return result
    })().finally(() => {
      this.pendingLevelRequests.delete(key)
    })

    this.pendingLevelRequests.set(key, request)
    return request
  }

  private makeCachedWaveform(
    peaks: Float32Array,
    duration: number,
    channels: number,
    isComplete: boolean,
    stereo = false,
    maxPeak = 1,
    loadedSamples = peaks.length,
    sampleRate = SAMPLES_PER_SECOND,
  ): CachedWaveform {
    return {
      peaks,
      duration,
      sampleRate,
      channels,
      stereo,
      maxPeak: maxPeak > 0 ? maxPeak : 1,
      loadedSamples: Math.max(0, Math.min(peaks.length, loadedSamples)),
      sizeBytes: peaks.byteLength,
      lastAccessed: Date.now(),
      isComplete,
    }
  }

  private computeMaxPeak(peaks: Float32Array): number {
    let maxPeak = 0
    for (let i = 0; i < peaks.length; i++) {
      const value = peaks[i] ?? 0
      if (value > maxPeak) {
        maxPeak = value
      }
    }
    return maxPeak > 0 ? maxPeak : 1
  }

  private async persistToOPFS(
    mediaId: string,
    peaks: Float32Array,
    duration: number,
    channels: number,
    sourceSampleRate = SAMPLES_PER_SECOND,
  ): Promise<void> {
    try {
      const levels = waveformOPFSStorage.generateMultiResolution(
        peaks,
        sourceSampleRate,
        duration,
        channels >= 2 ? 2 : 1,
      )

      const multiRes: MultiResolutionWaveform = {
        duration,
        channels,
        levels,
      }

      await waveformOPFSStorage.save(mediaId, multiRes)
    } catch (saveError) {
      logger.warn('Failed to persist waveform to OPFS:', saveError)
    }
  }

  private async persistBinnedWaveform(
    mediaId: string,
    peaks: Float32Array,
    duration: number,
    channels: number,
  ): Promise<void> {
    await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
      logger.debug('Failed to clear waveform before persist:', mediaId, e)
    })

    const binCount = Math.ceil(peaks.length / WAVEFORM_BIN_SAMPLES)
    const now = Date.now()
    for (let binIndex = 0; binIndex < binCount; binIndex++) {
      const start = binIndex * WAVEFORM_BIN_SAMPLES
      const end = Math.min(start + WAVEFORM_BIN_SAMPLES, peaks.length)
      const chunk = peaks.slice(start, end)
      const bin: WaveformBin = {
        id: `${mediaId}:bin:${binIndex}`,
        mediaId,
        kind: 'bin',
        binIndex,
        peaks: chunk.buffer,
        samples: chunk.length,
        createdAt: now,
      }
      await saveWaveformBinToIndexedDB(bin)
    }

    await saveWaveformMetaToIndexedDB({
      id: mediaId,
      mediaId,
      kind: 'meta',
      sampleRate: SAMPLES_PER_SECOND,
      totalSamples: peaks.length,
      binCount,
      binDurationSec: WAVEFORM_BIN_DURATION_SEC,
      duration,
      channels,
      stereo: channels >= 2 || undefined,
      createdAt: now,
    })
  }

  private async loadFromStorage(mediaId: string): Promise<CachedWaveform | null> {
    try {
      const meta = await getWaveformMetaFromIndexedDB(mediaId)
      if (meta) {
        if (meta.sampleRate !== SAMPLES_PER_SECOND) {
          await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
            logger.debug('Failed to clear stale-rate waveform:', mediaId, e)
          })
          return null
        }

        if (meta.channels >= 2 && !meta.stereo) {
          await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
            logger.debug('Failed to clear stale mono waveform:', mediaId, e)
          })
          return null
        }

        const bins = await getWaveformBinsFromIndexedDB(mediaId, meta.binCount)
        if (bins.length === meta.binCount) {
          const peaks = new Float32Array(meta.totalSamples)
          let writeOffset = 0
          let valid = true

          for (let i = 0; i < bins.length; i++) {
            const bin = bins[i]
            if (!bin || bin.binIndex !== i || !bin.peaks) {
              valid = false
              break
            }

            const binPeaks = new Float32Array(bin.peaks)
            const expectedSamples = Math.max(0, bin.samples ?? binPeaks.length)
            const available = Math.min(expectedSamples, binPeaks.length, peaks.length - writeOffset)
            if (available <= 0) {
              valid = false
              break
            }

            peaks.set(binPeaks.subarray(0, available), writeOffset)
            writeOffset += available
          }

          if (valid && writeOffset === meta.totalSamples) {
            const cached: CachedWaveform = {
              peaks,
              duration: meta.duration,
              sampleRate: meta.sampleRate,
              channels: meta.channels,
              stereo: meta.stereo === true,
              maxPeak: this.computeMaxPeak(peaks),
              loadedSamples: peaks.length,
              sizeBytes: peaks.byteLength,
              lastAccessed: Date.now(),
              isComplete: true,
            }

            this.addToMemoryCache(mediaId, cached)
            this.notifyUpdate(mediaId, cached)
            return cached
          }
        }

        await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
          logger.debug('Failed to clear invalid waveform bins:', mediaId, e)
        })
        return null
      }

      const firstBin = await getWaveformRecordFromIndexedDB(`${mediaId}:bin:0`)
      if (firstBin && 'kind' in firstBin && firstBin.kind === 'bin') {
        await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
          logger.debug('Failed to clear partial waveform:', mediaId, e)
        })
        return null
      }
    } catch (error) {
      logger.warn(`Failed to load binned waveform from IndexedDB: ${mediaId}`, error)
    }

    try {
      const level = await waveformOPFSStorage.getLevel(mediaId, 0)
      if (level) {
        if (level.sampleRate !== SAMPLES_PER_SECOND) {
          return null
        }
        const floatsPerSample = level.channels >= 2 ? 2 : 1
        const cached: CachedWaveform = {
          peaks: level.peaks,
          duration: level.peaks.length / floatsPerSample / level.sampleRate,
          sampleRate: level.sampleRate,
          channels: level.channels,
          stereo: level.channels >= 2,
          maxPeak: this.computeMaxPeak(level.peaks),
          loadedSamples: level.peaks.length,
          sizeBytes: level.peaks.byteLength,
          lastAccessed: Date.now(),
          isComplete: true,
        }

        this.addToMemoryCache(mediaId, cached)
        this.notifyUpdate(mediaId, cached)
        return cached
      }
    } catch (err) {
      await waveformOPFSStorage.delete(mediaId).catch((e) => {
        logger.debug('Failed to delete corrupted OPFS waveform:', mediaId, e)
      })
    }

    try {
      const stored = await getLegacyWaveformFromIndexedDB(mediaId)

      if (stored && stored.peaks) {
        if (stored.sampleRate !== SAMPLES_PER_SECOND) {
          await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
            logger.debug('Failed to clear stale legacy waveform:', mediaId, e)
          })
          return null
        }

        const peaks = new Float32Array(stored.peaks)

        const cached: CachedWaveform = {
          peaks,
          duration: stored.duration,
          sampleRate: stored.sampleRate,
          channels: stored.channels,
          stereo: false,
          maxPeak: this.computeMaxPeak(peaks),
          loadedSamples: peaks.length,
          sizeBytes: stored.peaks.byteLength,
          lastAccessed: Date.now(),
          isComplete: true,
        }

        this.addToMemoryCache(mediaId, cached)
        this.notifyUpdate(mediaId, cached)
        this.migrateToOPFS(mediaId, peaks, stored.duration, stored.channels).catch((e) => {
          logger.debug('Waveform OPFS migration failed:', mediaId, e)
        })

        return cached
      }
    } catch (error) {
      logger.warn(`Failed to load legacy waveform from IndexedDB: ${mediaId}`, error)
    }

    return null
  }

  private async migrateToOPFS(
    mediaId: string,
    peaks: Float32Array,
    duration: number,
    channels: number,
  ): Promise<void> {
    try {
      const levels = waveformOPFSStorage.generateMultiResolution(
        peaks,
        100,
        duration,
      )

      const multiRes: MultiResolutionWaveform = {
        duration,
        channels,
        levels,
      }

      await waveformOPFSStorage.save(mediaId, multiRes)
      await deleteWaveformFromIndexedDB(mediaId)
    } catch (err) {
      logger.warn(`Failed to migrate waveform ${mediaId}:`, err)
    }
  }

  private async generateWaveformWithWorker(
    mediaId: string,
    blobUrl: string,
    requestId: string,
    onProgress?: (progress: number) => void,
    options: WaveformGenerationOptions = {},
  ): Promise<CachedWaveform> {
    const worker = this.getWorker()
    const samplesPerSecond = options.samplesPerSecond ?? SAMPLES_PER_SECOND
    const persistBins = options.persistBins ?? samplesPerSecond === SAMPLES_PER_SECOND
    const persistOPFS = options.persistOPFS ?? true
    const timeoutMs = options.timeoutMs ?? 90_000
    const updateMemoryCache = options.updateMemoryCache ?? true
    const isCompleteResult = options.isComplete ?? true

    return new Promise((resolve, reject) => {
      const pendingBinWrites: Promise<void>[] = []
      let duration = 0
      let channels = 1
      let stereo = false
      let peaks: Float32Array | null = null
      let loadedSamples = 0
      let maxPeak = 0
      let settled = false
      let lastReportedProgress = -1
      let lastProgressReportAt = 0
      let lastWaveformNotifyAt = 0
      let lastNotifiedLoadedSamples = 0

      const cleanup = () => {
        clearTimeout(timeout)
        worker.removeEventListener('message', handleMessage)
        worker.removeEventListener('error', handleError)
        this.workerRejectors.delete(requestId)
      }

      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const resolveOnce = (waveform: CachedWaveform) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(waveform)
      }

      const reportProgress = (nextProgress: number, force = false) => {
        if (!onProgress) return
        const clamped = Math.max(0, Math.min(100, Math.round(nextProgress)))
        const now = Date.now()
        if (
          force ||
          clamped === 100 ||
          lastReportedProgress < 0 ||
          clamped - lastReportedProgress >= WAVEFORM_PROGRESS_NOTIFY_STEP ||
          now - lastProgressReportAt >= WAVEFORM_PROGRESS_NOTIFY_INTERVAL_MS
        ) {
          lastReportedProgress = clamped
          lastProgressReportAt = now
          onProgress(clamped)
        }
      }

      const notifyWaveformUpdate = (force = false) => {
        if (!peaks) return
        const now = Date.now()
        if (!force && loadedSamples < peaks.length && loadedSamples === lastNotifiedLoadedSamples) {
          return
        }

        if (
          !force &&
          now - lastWaveformNotifyAt < WAVEFORM_NOTIFY_INTERVAL_MS &&
          loadedSamples < peaks.length
        ) {
          return
        }

        lastWaveformNotifyAt = now
        lastNotifiedLoadedSamples = loadedSamples
        const cached = this.makeCachedWaveform(
          peaks,
          duration,
          channels,
          isCompleteResult && loadedSamples >= peaks.length,
          stereo,
          maxPeak,
          loadedSamples,
          samplesPerSecond,
        )
        if (updateMemoryCache) {
          this.addToMemoryCache(mediaId, cached)
          this.notifyUpdate(mediaId, cached)
        }
      }

      const timeout = setTimeout(() => {
        try {
          worker.postMessage({ type: 'abort', requestId })
        } catch {
          // Ignore
        }
        if (this.workerManager.peekWorker() === worker) {
          this.workerManager.terminate()
        }
        rejectOnce(new Error('Worker timeout'))
      }, timeoutMs)

      const handleMessage = async (event: MessageEvent<WaveformWorkerResponse>) => {
        if (event.data.requestId !== requestId) return
        try {
          switch (event.data.type) {
            case 'progress':
              reportProgress(event.data.progress)
              break

            case 'init': {
              duration = event.data.duration
              channels = event.data.channels
              stereo = event.data.stereo
              peaks = new Float32Array(event.data.totalSamples)
              break
            }

            case 'chunk': {
              if (!peaks) break
              const { startIndex, peaks: chunkPeaks } = event.data
              peaks.set(chunkPeaks, startIndex)
              loadedSamples = Math.max(loadedSamples, startIndex + chunkPeaks.length)

              for (let i = 0; i < chunkPeaks.length; i++) {
                const value = chunkPeaks[i] ?? 0
                if (value > maxPeak) {
                  maxPeak = value
                }
              }
              if (persistBins) {
                const effectiveBinSamples = WAVEFORM_BIN_SAMPLES * (stereo ? 2 : 1)
                const binIndex = Math.floor(startIndex / effectiveBinSamples)
                const bin: WaveformBin = {
                  id: `${mediaId}:bin:${binIndex}`,
                  mediaId,
                  kind: 'bin',
                  binIndex,
                  peaks: chunkPeaks.buffer as ArrayBuffer,
                  samples: chunkPeaks.length,
                  createdAt: Date.now(),
                }
                pendingBinWrites.push(
                  saveWaveformBinToIndexedDB(bin).catch((saveError) => {
                    logger.warn(`Failed to persist waveform bin ${mediaId}:${binIndex}`, saveError)
                  }),
                )
              }
              notifyWaveformUpdate()
              break
            }

            case 'complete': {
              if (!peaks) {
                rejectOnce(new Error('Worker completed without waveform init'))
                break
              }

              await Promise.all(pendingBinWrites)
              if (settled) {
                break
              }
              if (persistBins) {
                const metaBinSamples = WAVEFORM_BIN_SAMPLES * (stereo ? 2 : 1)
                await saveWaveformMetaToIndexedDB({
                  id: mediaId,
                  mediaId,
                  kind: 'meta',
                  sampleRate: SAMPLES_PER_SECOND,
                  totalSamples: peaks.length,
                  binCount: Math.ceil(peaks.length / metaBinSamples),
                  binDurationSec: WAVEFORM_BIN_DURATION_SEC,
                  duration,
                  channels,
                  stereo: stereo || undefined,
                  createdAt: Date.now(),
                })
              }

              loadedSamples = peaks.length
              maxPeak = event.data.maxPeak > 0 ? event.data.maxPeak : Math.max(maxPeak, 1)
              notifyWaveformUpdate(true)
              const cached = this.makeCachedWaveform(
                peaks,
                duration,
                channels,
                isCompleteResult,
                stereo,
                maxPeak,
                loadedSamples,
                samplesPerSecond,
              )
              if (persistOPFS) {
                void this.persistToOPFS(mediaId, peaks, duration, channels, samplesPerSecond)
              }

              reportProgress(100, true)
              resolveOnce(cached)
              break
            }

            case 'error':
              rejectOnce(new Error(event.data.error))
              break
          }
        } catch (handlerError) {
          rejectOnce(handlerError instanceof Error ? handlerError : new Error(String(handlerError)))
        }
      }

      const handleError = (event: ErrorEvent) => {
        logger.error('Waveform worker error:', event.message)
        rejectOnce(new Error(event.message || 'Worker error'))
      }

      this.workerRejectors.set(requestId, rejectOnce)
      const startWorker = async () => {
        if (persistBins) {
          await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
            logger.debug('Failed to clear waveform before worker gen:', mediaId, e)
          })
        }
        if (settled) return

        worker.addEventListener('message', handleMessage)
        worker.addEventListener('error', handleError)

        worker.postMessage({
          type: 'generate',
          requestId,
          blobUrl,
          blob: getObjectUrlDirectFileMetadata(blobUrl)
            ? undefined
            : (getObjectUrlBlob(blobUrl) ?? undefined),
          sourceMetadata: getObjectUrlDirectFileMetadata(blobUrl) ?? undefined,
          samplesPerSecond,
          binDurationSec: WAVEFORM_BIN_DURATION_SEC,
          startTimeSec: options.startTimeSec,
          endTimeSec: options.endTimeSec,
        })
      }
      void startWorker().catch((startError) => {
        rejectOnce(startError instanceof Error ? startError : new Error(String(startError)))
      })
    })
  }

  private generateStereoPeaksFallback(
    audioBuffer: AudioBuffer,
    channels: number,
    numOutputSamples: number,
    samplesPerOutput: number,
    duration: number,
    throwIfAborted: () => void,
    onProgress?: (progress: number) => void,
  ): CachedWaveform {
    const ch0 = audioBuffer.getChannelData(0)
    const ch1 = audioBuffer.getChannelData(Math.min(1, channels - 1))
    const peaks = new Float32Array(numOutputSamples * 2)

    for (let i = 0; i < numOutputSamples; i++) {
      const startIdx = i * samplesPerOutput
      const endIdx = Math.min(startIdx + samplesPerOutput, audioBuffer.length)

      let maxL = 0
      let maxR = 0
      for (let j = startIdx; j < endIdx; j++) {
        const lVal = Math.abs(ch0[j] ?? 0)
        const rVal = Math.abs(ch1[j] ?? 0)
        if (lVal > maxL) maxL = lVal
        if (rVal > maxR) maxR = rVal
      }
      peaks[i * 2] = maxL
      peaks[i * 2 + 1] = maxR
      if ((i & 255) === 0) {
        throwIfAborted()
      }
    }
    onProgress?.(85)
    throwIfAborted()

    let maxPeak = 0
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i]! > maxPeak) maxPeak = peaks[i]!
    }
    if (maxPeak > 0) {
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] = peaks[i]! / maxPeak
      }
    }

    return this.makeCachedWaveform(peaks, duration, channels, true, true)
  }

  private generateMonoPeaksFallback(
    audioBuffer: AudioBuffer,
    channels: number,
    numOutputSamples: number,
    samplesPerOutput: number,
    duration: number,
    throwIfAborted: () => void,
    onProgress?: (progress: number) => void,
  ): CachedWaveform {
    const monoSamples = new Float32Array(audioBuffer.length)
    for (let c = 0; c < channels; c++) {
      const channelData = audioBuffer.getChannelData(c)
      for (let i = 0; i < audioBuffer.length; i++) {
        monoSamples[i]! += channelData[i]! / channels
        if ((i & 4095) === 0) {
          throwIfAborted()
        }
      }
    }
    onProgress?.(70)
    throwIfAborted()

    const peaks = new Float32Array(numOutputSamples)

    for (let i = 0; i < numOutputSamples; i++) {
      const startIdx = i * samplesPerOutput
      const endIdx = Math.min(startIdx + samplesPerOutput, audioBuffer.length)

      let maxVal = 0
      for (let j = startIdx; j < endIdx; j++) {
        const val = Math.abs(monoSamples[j] ?? 0)
        if (val > maxVal) maxVal = val
      }
      peaks[i] = maxVal
      if ((i & 255) === 0) {
        throwIfAborted()
      }
    }
    onProgress?.(85)
    throwIfAborted()

    let maxPeak = 0
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i]! > maxPeak) maxPeak = peaks[i]!
    }
    if (maxPeak > 0) {
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] = peaks[i]! / maxPeak
      }
    }

    return this.makeCachedWaveform(peaks, duration, channels, true, false)
  }

  /**
   * Safe Fallback: Generate waveform with Web Audio API, guarded against 300MB RAM floods
   */
  private async generateWaveformFallback(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<CachedWaveform> {
    if (signal?.aborted) {
      throw new AbortError()
    }
    onProgress?.(10)

    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new AbortError()
      }
    }

    try {
      const response = await fetch(blobUrl, signal ? { signal } : undefined)
      throwIfAborted()

      const arrayBuffer = await response.arrayBuffer()
      onProgress?.(30)
      throwIfAborted()

      // Guard: If audio file is larger than 15MB, avoid uncompressing into RAM via Web Audio
      if (arrayBuffer.byteLength > 15 * 1024 * 1024) {
        logger.warn(`Audio buffer too large for main thread decode (${arrayBuffer.byteLength} bytes); returning flat fallback to save RAM`)
        const fallbackPeaks = new Float32Array(500 * 10) // 10s empty estimate
        return this.makeCachedWaveform(fallbackPeaks, 10, 1, true, false)
      }

      const audioContext = new AudioContext()
      const closeContext = () => {
        void audioContext.close().catch(() => {})
      }
      signal?.addEventListener('abort', closeContext, { once: true })

      try {
        let audioBuffer: AudioBuffer
        try {
          audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
        } catch (decodeError) {
          logger.warn(`AudioContext.decodeAudioData failed for ${mediaId}`, decodeError)
          const fallbackPeaks = new Float32Array(500 * 5)
          return this.makeCachedWaveform(fallbackPeaks, 5, 1, true, false)
        }

        onProgress?.(60)
        throwIfAborted()

        const duration = audioBuffer.duration
        const channels = audioBuffer.numberOfChannels
        const stereo = channels >= 2

        const numOutputSamples = Math.ceil(duration * SAMPLES_PER_SECOND)
        const samplesPerOutput = Math.floor(audioBuffer.length / numOutputSamples)

        const cached = stereo
          ? this.generateStereoPeaksFallback(
              audioBuffer,
              channels,
              numOutputSamples,
              samplesPerOutput,
              duration,
              throwIfAborted,
              onProgress,
            )
          : this.generateMonoPeaksFallback(
              audioBuffer,
              channels,
              numOutputSamples,
              samplesPerOutput,
              duration,
              throwIfAborted,
              onProgress,
            )

        this.addToMemoryCache(mediaId, cached)
        this.notifyUpdate(mediaId, cached)

        await this.persistBinnedWaveform(mediaId, cached.peaks, duration, channels).catch((err) => {
          logger.warn('Failed to persist waveform bins to IndexedDB:', err)
        })
        void this.persistToOPFS(mediaId, cached.peaks, duration, channels)

        onProgress?.(100)
        return cached
      } finally {
        signal?.removeEventListener('abort', closeContext)
        await audioContext.close().catch(() => {})
      }
    } catch (error) {
      if (error instanceof AbortError) {
        throw error
      }
      if (signal?.aborted) {
        throw new AbortError()
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AbortError()
      }
      // Return a safe flat fallback on error instead of hanging
      logger.warn(`Waveform generation failed for ${mediaId}, returning fallback`, error)
      const fallbackPeaks = new Float32Array(500 * 5)
      return this.makeCachedWaveform(fallbackPeaks, 5, 1, true, false)
    }
  }

  private async generateWaveform(
    mediaId: string,
    blobUrl: string,
    requestId: string,
    onProgress?: (progress: number) => void,
  ): Promise<CachedWaveform> {
    try {
      return await this.generateWaveformWithWorker(mediaId, blobUrl, requestId, onProgress)
    } catch (err) {
      if (err instanceof AbortError) {
        throw err
      }
      logger.warn(`Waveform worker failed for ${mediaId}, falling back to AudioContext`, err)
      const controller = new AbortController()
      const fallbackRejector = () => controller.abort()
      this.fallbackAbortControllers.set(requestId, controller)
      this.workerRejectors.set(requestId, fallbackRejector)
      try {
        return await this.generateWaveformFallback(mediaId, blobUrl, onProgress, controller.signal)
      } finally {
        const activeRejector = this.workerRejectors.get(requestId)
        if (activeRejector === fallbackRejector) {
          this.workerRejectors.delete(requestId)
        }
        const activeController = this.fallbackAbortControllers.get(requestId)
        if (activeController === controller) {
          this.fallbackAbortControllers.delete(requestId)
        }
      }
    }
  }

  async getWaveform(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void,
  ): Promise<CachedWaveform> {
    const memoryCached = this.getFromMemoryCache(mediaId)
    if (memoryCached?.isComplete && memoryCached.sampleRate === SAMPLES_PER_SECOND) {
      return memoryCached
    }

    const pending = this.pendingRequests.get(mediaId)
    if (pending) {
      return pending.promise
    }

    if (memoryCached && memoryCached.sampleRate === SAMPLES_PER_SECOND) {
      return memoryCached
    }

    const storedCached = await this.loadFromStorage(mediaId)
    if (storedCached) {
      return storedCached
    }

    const pendingAfterStorage = this.pendingRequests.get(mediaId)
    if (pendingAfterStorage) {
      return pendingAfterStorage.promise
    }

    return this.enqueueGeneration(mediaId, blobUrl, onProgress)
  }

  async prepareOverviewWaveform(
    mediaId: string,
    blobUrl: string,
    onProgress?: (progress: number) => void,
  ): Promise<CachedWaveform | null> {
    const fullMemoryCached = this.getFromMemoryCache(mediaId)
    if (fullMemoryCached?.isComplete && fullMemoryCached.sampleRate === SAMPLES_PER_SECOND) {
      return fullMemoryCached
    }

    const persistedMetadata = await waveformOPFSStorage.getMetadata(mediaId)
    if (persistedMetadata) {
      const overviewLevelIndex = Math.min(
        WAVEFORM_LEVELS.length - 1,
        persistedMetadata.levels.length - 1,
      )
      const level = await this.getDisplayLevel(mediaId, Math.max(0, overviewLevelIndex))
      if (level) {
        return this.makeCachedWaveform(
          level.peaks,
          level.duration,
          level.channels,
          true,
          level.stereo,
          level.maxPeak,
          level.loadedSamples,
          level.sampleRate,
        )
      }
    }

    const pending = this.pendingRequests.get(mediaId)
    if (pending) {
      return pending.promise
    }

    const requestId = `waveform-overview-${++this.workerRequestId}`
    return this.generateWaveformWithWorker(mediaId, blobUrl, requestId, onProgress, {
      samplesPerSecond: WAVEFORM_OVERVIEW_SAMPLES_PER_SECOND,
      persistBins: false,
      persistOPFS: true,
      timeoutMs: 45_000,
    })
  }

  async prepareVisibleWaveformRange(
    mediaId: string,
    blobUrl: string,
    startTimeSec: number,
    endTimeSec: number,
    pixelsPerSecond: number,
    onProgress?: (progress: number) => void,
  ): Promise<CachedWaveform | null> {
    const fullMemoryCached = this.getFromMemoryCache(mediaId)
    if (fullMemoryCached?.isComplete && fullMemoryCached.sampleRate === SAMPLES_PER_SECOND) {
      return fullMemoryCached
    }

    if (this.pendingRequests.has(mediaId)) {
      return null
    }

    const safeStart = Math.max(0, Math.floor(startTimeSec * 10) / 10)
    const safeEnd = Math.max(safeStart + 0.25, Math.ceil(endTimeSec * 10) / 10)
    const levelIndex = chooseLevelForZoom(pixelsPerSecond)
    const samplesPerSecond = Math.min(
      WAVEFORM_VISIBLE_RANGE_MAX_SAMPLES_PER_SECOND,
      WAVEFORM_LEVELS[levelIndex] ?? WAVEFORM_OVERVIEW_SAMPLES_PER_SECOND,
    )
    const cachedRange = await waveformOPFSStorage.getCachedRange(
      mediaId,
      samplesPerSecond,
      safeStart,
      safeEnd,
    )
    if (cachedRange) {
      return this.makeCachedWaveform(
        cachedRange.peaks,
        cachedRange.duration,
        cachedRange.channels,
        false,
        cachedRange.channels >= 2,
        this.computeMaxPeak(cachedRange.peaks),
        cachedRange.peaks.length,
        cachedRange.sampleRate,
      )
    }

    const key = `${mediaId}:${samplesPerSecond}:${safeStart}:${safeEnd}`
    const pending = this.pendingRangeRequests.get(key)
    if (pending) {
      return pending
    }

    const requestId = `waveform-range-${++this.workerRequestId}`
    const request = this.generateWaveformWithWorker(mediaId, blobUrl, requestId, onProgress, {
      samplesPerSecond,
      persistBins: false,
      persistOPFS: false,
      updateMemoryCache: false,
      isComplete: false,
      startTimeSec: safeStart,
      endTimeSec: safeEnd,
      timeoutMs: 20_000,
    })
      .then((waveform) => {
        void waveformOPFSStorage
          .saveRange(mediaId, {
            duration: waveform.duration,
            channels: waveform.channels,
            sampleRate: waveform.sampleRate,
            startTime: safeStart,
            endTime: safeEnd,
            peaks: waveform.peaks,
          })
          .catch((error) => {
            logger.warn(`Failed to persist waveform range for ${mediaId}`, error)
          })
        return waveform
      })
      .catch((error) => {
        logger.warn(`Visible waveform range generation failed for ${mediaId}`, error)
        return null
      })
      .finally(() => {
        this.pendingRangeRequests.delete(key)
      })

    this.pendingRangeRequests.set(key, request)
    return request
  }

  async getCachedWaveform(mediaId: string): Promise<CachedWaveform | null> {
    const memoryCached = this.getFromMemoryCache(mediaId)
    if (memoryCached) {
      return memoryCached
    }

    return this.loadFromStorage(mediaId)
  }

  prefetch(mediaId: string, blobUrl?: string | null): void {
    void blobUrl
    if (this.getFromMemoryCache(mediaId) || this.pendingRequests.has(mediaId)) {
      return
    }

    this.loadFromStorage(mediaId).catch((error) => {
      logger.warn('Waveform storage load failed during prefetch:', error)
    })
  }

  abort(mediaId: string): void {
    const pending = this.pendingRequests.get(mediaId)
    if (!pending) return

    if (pending.status === 'queued') {
      this.generationQueue = this.generationQueue.filter(
        (queued) => !(queued.mediaId === mediaId && queued.requestId === pending.requestId),
      )
      this.pendingRequests.delete(mediaId)
      pending.reject(new AbortError())
      this.processGenerationQueue()
      return
    }

    this.pendingRequests.delete(mediaId)
    this.activeGenerations.delete(mediaId)

    const activeWorker = this.workerManager.peekWorker()
    if (activeWorker) {
      activeWorker.postMessage({
        type: 'abort',
        requestId: pending.requestId,
      })
    }
    const fallbackController = this.fallbackAbortControllers.get(pending.requestId)
    fallbackController?.abort()

    const rejector = this.workerRejectors.get(pending.requestId)
    if (rejector) {
      rejector(new AbortError())
    }

    this.processGenerationQueue()
  }

  async clearMedia(mediaId: string): Promise<void> {
    this.levelMediaGeneration.set(mediaId, (this.levelMediaGeneration.get(mediaId) ?? 0) + 1)

    this.memoryCache.delete(mediaId)
    for (let levelIndex = 0; levelIndex < WAVEFORM_LEVELS.length; levelIndex++) {
      this.levelCache.delete(this.levelCacheKey(mediaId, levelIndex))
    }
    for (const key of this.pendingRangeRequests.keys()) {
      if (key.startsWith(`${mediaId}:`)) {
        this.pendingRangeRequests.delete(key)
      }
    }

    await waveformOPFSStorage.delete(mediaId)
    await deleteWaveformFromIndexedDB(mediaId).catch((e) => {
      logger.debug('Failed to clear waveform from IndexedDB during cache clear:', mediaId, e)
    })
  }

  clearAll(): void {
    this.levelGlobalGeneration += 1
    this.levelMediaGeneration.clear()
    this.memoryCache.clear()
    this.levelCache.clear()
    this.pendingRangeRequests.clear()
  }

  dispose(): void {
    this.clearAll()
    this.generationQueue = []
    const pendingIds = Array.from(this.pendingRequests.keys())
    for (const mediaId of pendingIds) {
      this.abort(mediaId)
    }
    for (const controller of this.fallbackAbortControllers.values()) {
      controller.abort()
    }
    this.fallbackAbortControllers.clear()
    this.activeGenerations.clear()
    this.workerRejectors.clear()
    this.pendingRequests.clear()
    this.pendingRangeRequests.clear()
    this.updateCallbacks.clear()
    this.workerManager.terminate()
  }

  async getWaveformRange(
    mediaId: string,
    startTime: number,
    endTime: number,
    pixelsPerSecond: number,
  ): Promise<{
    peaks: Float32Array
    sampleRate: number
    startSample: number
  } | null> {
    const levelIndex = chooseLevelForZoom(pixelsPerSecond)
    return waveformOPFSStorage.getLevelRange(mediaId, levelIndex, startTime, endTime)
  }

  async getWaveformLevel(
    mediaId: string,
    pixelsPerSecond: number,
  ): Promise<{
    peaks: Float32Array
    sampleRate: number
    channels: number
  } | null> {
    const levelIndex = chooseLevelForZoom(pixelsPerSecond)
    return waveformOPFSStorage.getLevel(mediaId, levelIndex)
  }
}

export const waveformCache = new WaveformCacheService()

const monoPeaksCache = new WeakMap<Float32Array, Float32Array>()

export function getMonoPeaks(waveform: CachedWaveform): Float32Array {
  if (!waveform.stereo) return waveform.peaks

  if (waveform.isComplete) {
    const cached = monoPeaksCache.get(waveform.peaks)
    if (cached) return cached
  }

  const perChannel = waveform.peaks.length / 2
  const mono = new Float32Array(perChannel)
  for (let i = 0; i < perChannel; i++) {
    mono[i] = Math.max(waveform.peaks[i * 2] ?? 0, waveform.peaks[i * 2 + 1] ?? 0)
  }

  if (waveform.isComplete) {
    monoPeaksCache.set(waveform.peaks, mono)
  }

  return mono
}
