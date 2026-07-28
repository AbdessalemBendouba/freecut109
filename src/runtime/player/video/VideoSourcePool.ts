import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('VideoSourcePool')

/**
 * VideoSourcePool.ts - Manages video elements by source URL
 *
 * Optimized for low-end 32-bit hardware:
 * - Max 1 overflow video element (prevents CPU thread thrashing & decoder memory exhaustion)
 * - Quick readiness resolution at HAVE_METADATA (readyState >= 1)
 */

interface EnsureReadyLanesOptions {
  targetTimeSeconds?: number[]
  warmDecode?: boolean
}

const VIDEO_POOL_ABORT_PREFIX = 'VIDEO_POOL_ABORT:'

function createVideoPoolAbortError(reason: string): Error {
  const error = new Error(`${VIDEO_POOL_ABORT_PREFIX}${reason}`)
  error.name = 'AbortError'
  return error
}

export function isVideoPoolAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || error.message.startsWith(VIDEO_POOL_ABORT_PREFIX)
}

class SourceController {
  readonly sourceUrl: string
  private primary: HTMLVideoElement | null = null
  private overflow: HTMLVideoElement[] = []
  private assignments: Map<string, HTMLVideoElement> = new Map()
  private loadPromise: Promise<void> | null = null
  private _pendingPrimary: HTMLVideoElement | null = null

  private onElementReady?: (element: HTMLVideoElement) => void
  private onElementError?: (element: HTMLVideoElement, error: Error) => void

  // Capped overflow elements to 1 (max 2 decoders total) for Pentium G620 CPU safety
  private static readonly MAX_OVERFLOW_ELEMENTS = 1
  private static readonly LOAD_TIMEOUT_MS = 300_000 // Extended timeout for slow HDDs

  private _loadTimeoutId: ReturnType<typeof setTimeout> | null = null

  constructor(
    sourceUrl: string,
    options?: {
      onElementReady?: (element: HTMLVideoElement) => void
      onElementError?: (element: HTMLVideoElement, error: Error) => void
    },
  ) {
    this.sourceUrl = sourceUrl
    this.onElementReady = options?.onElementReady
    this.onElementError = options?.onElementError
  }

  async ensureLoaded(): Promise<HTMLVideoElement> {
    if (this.primary) {
      return this.primary
    }

    if (this.loadPromise) {
      await this.loadPromise
      return this.primary!
    }

    const element = this.createElementSync()
    this._pendingPrimary = element

    this.loadPromise = new Promise<void>((resolve, reject) => {
      // Resolve immediately when metadata is available (readyState >= 1)
      const handleReady = () => {
        cleanup()
        resolve()
      }

      const onError = () => {
        const srcAttr = element.getAttribute('src') ?? ''
        const mediaMessage = element.error?.message || 'Unknown error'
        if (!srcAttr && /empty\s+src\s+attribute/i.test(mediaMessage)) {
          cleanup()
          reject(createVideoPoolAbortError('source-cleared-during-load'))
          return
        }

        cleanup()
        reject(new Error(`Failed to load video: ${mediaMessage}`))
      }

      const cleanup = () => {
        if (this._loadTimeoutId !== null) {
          clearTimeout(this._loadTimeoutId)
          this._loadTimeoutId = null
        }
        element.removeEventListener('loadedmetadata', handleReady)
        element.removeEventListener('canplay', handleReady)
        element.removeEventListener('error', onError)
      }

      if (element.readyState >= 1) {
        handleReady()
        return
      }

      element.addEventListener('loadedmetadata', handleReady)
      element.addEventListener('canplay', handleReady)
      element.addEventListener('error', onError)

      this._loadTimeoutId = setTimeout(() => {
        if (!(element.getAttribute('src') ?? '')) {
          cleanup()
          reject(createVideoPoolAbortError('source-cleared-before-ready'))
          return
        }

        cleanup()
        reject(
          new Error(
            `Video load timed out after ${SourceController.LOAD_TIMEOUT_MS}ms for: ${this.sourceUrl.slice(0, 80)}`,
          ),
        )
      }, SourceController.LOAD_TIMEOUT_MS)

      element.load()
    })
      .then(() => {
        this.primary = element
        this._pendingPrimary = null
      })
      .catch((err) => {
        if (this._pendingPrimary === element) {
          this._pendingPrimary = null
        }
        this.disposeElement(element)
        this.loadPromise = null
        throw err
      })

    await this.loadPromise
    return this.primary!
  }

  async ensureReadyLanes(minTotalLanes: number, options?: EnsureReadyLanesOptions): Promise<void> {
    if (minTotalLanes <= 0) {
      return
    }

    await this.ensureLoaded()

    while (this.getElementCount() < minTotalLanes) {
      const element = this.createElementSync()
      this.overflow.push(element)
      await this.waitForElementReady(element)
    }

    const idleElements = this.getManagedElements().filter(
      (element) => !this.isElementInUse(element),
    )
    const targetTimes = options?.targetTimeSeconds ?? []
    for (let index = 0; index < idleElements.length; index += 1) {
      const element = idleElements[index]!
      const targetTimeSeconds = targetTimes[index]
      if (targetTimeSeconds !== undefined) {
        this.seekElement(element, targetTimeSeconds)
      }
      if (options?.warmDecode) {
        await this.warmElement(element)
      }
    }
  }

  acquire(clipId: string): HTMLVideoElement | null {
    const existing = this.assignments.get(clipId)
    if (existing) {
      return existing
    }

    if (this.primary && !this.isElementInUse(this.primary)) {
      this.assignments.set(clipId, this.primary)
      return this.primary
    }

    if (this._pendingPrimary && !this.isElementInUse(this._pendingPrimary)) {
      this.primary = this._pendingPrimary
      this._pendingPrimary = null
      this.assignments.set(clipId, this.primary)
      return this.primary
    }

    for (const element of this.overflow) {
      if (!this.isElementInUse(element)) {
        this.assignments.set(clipId, element)
        return element
      }
    }

    if (this.overflow.length < SourceController.MAX_OVERFLOW_ELEMENTS) {
      const element = this.createElementSync()
      this.overflow.push(element)
      this.assignments.set(clipId, element)
      return element
    }

    logger.warn(`All pooled elements in use for ${this.sourceUrl}, creating extra overflow element`)
    const extraElement = this.createElementSync()
    this.overflow.push(extraElement)
    this.assignments.set(clipId, extraElement)
    return extraElement
  }

  release(clipId: string): void {
    this.assignments.delete(clipId)
    this.pruneIdleOverflowElements()
  }

  seekElement(
    element: HTMLVideoElement,
    sourceTimeSeconds: number,
    options?: { fast?: boolean },
  ): void {
    const duration = element.duration || Infinity
    const clampedTime = Math.max(0, Math.min(sourceTimeSeconds, duration - 0.001))

    const tolerance = options?.fast ? 0.1 : 0.016
    if (Math.abs(element.currentTime - clampedTime) < tolerance) {
      return
    }

    if (options?.fast && 'fastSeek' in element) {
      ;(element as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(clampedTime)
    } else {
      element.currentTime = clampedTime
    }
  }

  getAssignedElement(clipId: string): HTMLVideoElement | null {
    return this.assignments.get(clipId) || null
  }

  getActiveCount(): number {
    return this.assignments.size
  }

  getElementCount(): number {
    return (this.primary ? 1 : 0) + (this._pendingPrimary ? 1 : 0) + this.overflow.length
  }

  isInUse(): boolean {
    return this.assignments.size > 0
  }

  dispose(): void {
    if (this._loadTimeoutId !== null) {
      clearTimeout(this._loadTimeoutId)
      this._loadTimeoutId = null
    }

    if (this.primary) {
      this.disposeElement(this.primary)
    }

    if (this._pendingPrimary) {
      this.disposeElement(this._pendingPrimary)
      this._pendingPrimary = null
    }

    for (const element of this.overflow) {
      this.disposeElement(element)
    }

    this.primary = null
    this.overflow = []
    this.assignments.clear()
    this.loadPromise = null
  }

  private disposeElement(element: HTMLVideoElement): void {
    element.pause()
    element.src = ''
    element.load()
  }

  private pruneIdleOverflowElements(): void {
    for (
      let index = this.overflow.length - 1;
      index >= SourceController.MAX_OVERFLOW_ELEMENTS;
      index -= 1
    ) {
      const element = this.overflow[index]
      if (!element || this.isElementInUse(element)) {
        continue
      }
      this.disposeElement(element)
      this.overflow.splice(index, 1)
    }
  }

  private isElementInUse(element: HTMLVideoElement): boolean {
    for (const assigned of this.assignments.values()) {
      if (assigned === element) {
        return true
      }
    }
    return false
  }

  private getManagedElements(): HTMLVideoElement[] {
    return [
      ...(this.primary ? [this.primary] : []),
      ...(this._pendingPrimary ? [this._pendingPrimary] : []),
      ...this.overflow,
    ]
  }

  private async waitForElementReady(element: HTMLVideoElement): Promise<void> {
    if (element.readyState >= 1) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        element.removeEventListener('loadedmetadata', handleReady)
        element.removeEventListener('canplay', handleReady)
        element.removeEventListener('error', handleError)
      }

      const handleReady = () => {
        cleanup()
        resolve()
      }

      const handleError = () => {
        cleanup()
        reject(new Error(`Failed to load video: ${element.error?.message || 'Unknown error'}`))
      }

      element.addEventListener('loadedmetadata', handleReady)
      element.addEventListener('canplay', handleReady)
      element.addEventListener('error', handleError)

      timeoutId = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Video load timed out after ${SourceController.LOAD_TIMEOUT_MS}ms for: ${this.sourceUrl.slice(0, 80)}`,
          ),
        )
      }, SourceController.LOAD_TIMEOUT_MS)

      element.load()
    })
  }

  private async warmElement(element: HTMLVideoElement): Promise<void> {
    if (element.readyState < 1 || !element.paused) {
      return
    }

    const previousMuted = element.muted
    element.muted = true
    try {
      await element.play()
      await Promise.resolve()
      element.pause()
    } catch {
      // Best-effort decoder warmup.
    } finally {
      element.muted = previousMuted
    }
  }

  private createElementSync(): HTMLVideoElement {
    const element = document.createElement('video')
    element.src = this.sourceUrl
    element.preload = 'metadata' // Only preload metadata on low-RAM systems
    element.playsInline = true
    element.muted = true

    element.addEventListener('loadedmetadata', () => {
      this.onElementReady?.(element)
    })

    element.addEventListener('error', () => {
      const error = new Error(`Failed to load video: ${element.error?.message || 'Unknown error'}`)
      this.onElementError?.(element, error)
    })

    return element
  }
}

export class VideoSourcePool {
  private sources: Map<string, SourceController> = new Map()
  private clipToSource: Map<string, string> = new Map()
  private pendingReleaseTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  private onElementReady?: (sourceUrl: string, element: HTMLVideoElement) => void
  private onElementError?: (sourceUrl: string, error: Error) => void

  constructor(options?: {
    onElementReady?: (sourceUrl: string, element: HTMLVideoElement) => void
    onElementError?: (sourceUrl: string, error: Error) => void
  }) {
    this.onElementReady = options?.onElementReady
    this.onElementError = options?.onElementError
  }

  getSource(sourceUrl: string): SourceController {
    let controller = this.sources.get(sourceUrl)

    if (!controller) {
      controller = new SourceController(sourceUrl, {
        onElementReady: (element) => {
          this.onElementReady?.(sourceUrl, element)
        },
        onElementError: (_element, error) => {
          this.onElementError?.(sourceUrl, error)
        },
      })
      this.sources.set(sourceUrl, controller)
    }

    return controller
  }

  async preloadSource(sourceUrl: string): Promise<void> {
    const controller = this.getSource(sourceUrl)
    await controller.ensureLoaded()
  }

  acquireForClip(clipId: string, sourceUrl: string): HTMLVideoElement | null {
    this.cancelPendingRelease(clipId)

    const existingSourceUrl = this.clipToSource.get(clipId)
    if (existingSourceUrl && existingSourceUrl !== sourceUrl) {
      this.releaseClipNow(clipId)
    }

    const activeSourceUrl = this.clipToSource.get(clipId)
    if (activeSourceUrl === sourceUrl) {
      const existingController = this.sources.get(sourceUrl)
      const existingElement = existingController?.getAssignedElement(clipId)
      if (existingElement) {
        return existingElement
      }
    }

    const controller = this.getSource(sourceUrl)
    const element = controller.acquire(clipId)

    if (element) {
      this.clipToSource.set(clipId, sourceUrl)
    }

    return element
  }

  releaseClip(clipId: string, options?: { delayMs?: number }): void {
    const delayMs = Math.max(0, options?.delayMs ?? 0)
    this.cancelPendingRelease(clipId)

    if (delayMs > 0) {
      const timerId = setTimeout(() => {
        this.pendingReleaseTimers.delete(clipId)
        this.releaseClipNow(clipId)
      }, delayMs)
      this.pendingReleaseTimers.set(clipId, timerId)
      return
    }

    this.releaseClipNow(clipId)
  }

  async ensureReadyLanes(
    sourceUrl: string,
    minTotalLanes: number,
    options?: EnsureReadyLanesOptions,
  ): Promise<void> {
    const controller = this.getSource(sourceUrl)
    await controller.ensureReadyLanes(minTotalLanes, options)
  }

  seekClip(clipId: string, sourceTimeSeconds: number, options?: { fast?: boolean }): void {
    const sourceUrl = this.clipToSource.get(clipId)
    if (!sourceUrl) return

    const controller = this.sources.get(sourceUrl)
    if (!controller) return

    const element = controller.getAssignedElement(clipId)
    if (!element) return

    controller.seekElement(element, sourceTimeSeconds, options)
  }

  getClipElement(clipId: string): HTMLVideoElement | null {
    const sourceUrl = this.clipToSource.get(clipId)
    if (!sourceUrl) return null

    const controller = this.sources.get(sourceUrl)
    return controller?.getAssignedElement(clipId) || null
  }

  pruneUnused(activeSourceUrls: Set<string>): void {
    for (const [url, controller] of this.sources.entries()) {
      if (!activeSourceUrls.has(url) && !controller.isInUse()) {
        controller.dispose()
        this.sources.delete(url)
      }
    }
  }

  getStats(): {
    sourceCount: number
    totalElements: number
    activeClips: number
  } {
    let totalElements = 0
    let activeClips = 0

    for (const controller of this.sources.values()) {
      totalElements += controller.getElementCount()
      activeClips += controller.getActiveCount()
    }

    return {
      sourceCount: this.sources.size,
      totalElements,
      activeClips,
    }
  }

  dispose(): void {
    for (const timerId of this.pendingReleaseTimers.values()) {
      clearTimeout(timerId)
    }
    this.pendingReleaseTimers.clear()
    for (const controller of this.sources.values()) {
      controller.dispose()
    }
    this.sources.clear()
    this.clipToSource.clear()
  }

  private cancelPendingRelease(clipId: string): void {
    const timerId = this.pendingReleaseTimers.get(clipId)
    if (timerId !== undefined) {
      clearTimeout(timerId)
      this.pendingReleaseTimers.delete(clipId)
    }
  }

  private releaseClipNow(clipId: string): void {
    const sourceUrl = this.clipToSource.get(clipId)
    if (!sourceUrl) return

    const controller = this.sources.get(sourceUrl)
    controller?.release(clipId)
    this.clipToSource.delete(clipId)
  }
}

let globalPool: VideoSourcePool | null = null

export function getGlobalVideoSourcePool(): VideoSourcePool {
  if (!globalPool) {
    globalPool = new VideoSourcePool()
  }
  return globalPool
}
