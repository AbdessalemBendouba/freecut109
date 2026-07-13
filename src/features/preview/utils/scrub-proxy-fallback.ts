import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { getObjectUrlBlob } from '@/infrastructure/browser/object-url-registry'
import {
  getSharedProxyKey,
  importMediaLibraryService,
  proxyService,
  useMediaLibraryStore,
} from '../deps/media-library-contract'
import { importFilmstripCache } from '../deps/timeline-filmstrip'
import {
  cacheActivePreviewFallbackBitmap,
  getCachedActivePreviewFallbackBitmap,
  isActivePreviewTargetSuperseded,
  noteAutomaticScrubProxyRequest,
} from './decoder-prewarm'

const MAX_AUTOMATIC_PROXY_JOBS = 4
const MAX_FALLBACK_DRIFT_SECONDS = 0.75
const automaticProxyMediaIds = new Set<string>()
const fallbackGenerationBySource = new Map<string, number>()
const fallbackInflight = new Map<string, Promise<void>>()
let filmstripModulePromise: ReturnType<typeof importFilmstripCache> | null = null

function loadFilmstripModule() {
  filmstripModulePromise ??= importFilmstripCache()
  return filmstripModulePromise
}

export function warmScrubProxyFallback(): void {
  void loadFilmstripModule().then(({ filmstripCache }) => filmstripCache.prewarm())
}

function pruneAutomaticProxyJobs(): void {
  const statuses = useMediaLibraryStore.getState().proxyStatus
  for (const mediaId of automaticProxyMediaIds) {
    if (statuses.get(mediaId) !== 'generating') automaticProxyMediaIds.delete(mediaId)
  }
}

function scheduleAutomaticProxy(mediaId: string): void {
  const store = useMediaLibraryStore.getState()
  const media = store.mediaById[mediaId]
  if (!media || !proxyService.canGenerateProxy(media.mimeType)) return

  const proxyKey = getSharedProxyKey(media)
  proxyService.setProxyKey(media.id, proxyKey)
  if (proxyService.hasProxy(media.id, proxyKey)) {
    noteAutomaticScrubProxyRequest(true)
    return
  }
  if (store.proxyStatus.get(media.id) === 'generating') return

  pruneAutomaticProxyJobs()
  if (automaticProxyMediaIds.size >= MAX_AUTOMATIC_PROXY_JOBS) return
  automaticProxyMediaIds.add(media.id)
  noteAutomaticScrubProxyRequest(false)
  proxyService.generateProxy(
    media.id,
    media.storageType === 'opfs' && media.opfsPath
      ? { kind: 'opfs', path: media.opfsPath, mimeType: media.mimeType }
      : async () => {
          const { mediaLibraryService } = await importMediaLibraryService()
          return mediaLibraryService.getMediaFile(media.id)
        },
    media.width,
    media.height,
    proxyKey,
    { priority: 'background' },
  )
}

async function bitmapFromFrame(frame: { url: string; bitmap?: ImageBitmap }): Promise<ImageBitmap> {
  if (frame.bitmap) return createImageBitmap(frame.bitmap)
  const registeredBlob = getObjectUrlBlob(frame.url)
  if (registeredBlob) return createImageBitmap(registeredBlob)
  const response = await fetch(frame.url)
  if (!response.ok) throw new Error(`Scrub proxy frame unavailable (${response.status})`)
  return createImageBitmap(await response.blob())
}

export function scheduleScrubProxyFallback(src: string, timestamp: number): void {
  if (getCachedActivePreviewFallbackBitmap(src, timestamp)) return
  const mediaId = blobUrlManager.getMediaIdByUrl(src) ?? proxyService.getMediaIdByProxyUrl(src)
  if (!mediaId) return

  scheduleAutomaticProxy(mediaId)
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media || media.duration <= 0) return

  const generation = (fallbackGenerationBySource.get(src) ?? 0) + 1
  fallbackGenerationBySource.set(src, generation)
  const key = `${src}:${timestamp.toFixed(6)}`
  if (fallbackInflight.has(key)) return

  const request = (async () => {
    const { filmstripCache } = await loadFilmstripModule()
    const filmstrip =
      filmstripCache.getFromCacheSync(mediaId) ??
      (await filmstripCache.loadFromDisk(mediaId, media.duration))
    if (!filmstrip || filmstrip.frames.length === 0) return

    let nearest = filmstrip.frames[0]!
    let nearestDistance = Math.abs(nearest.timestamp - timestamp)
    for (let index = 1; index < filmstrip.frames.length; index += 1) {
      const candidate = filmstrip.frames[index]!
      const distance = Math.abs(candidate.timestamp - timestamp)
      if (distance < nearestDistance) {
        nearest = candidate
        nearestDistance = distance
      }
    }
    if (nearestDistance > MAX_FALLBACK_DRIFT_SECONDS) return

    const bitmap = await bitmapFromFrame(nearest)
    if (
      fallbackGenerationBySource.get(src) !== generation ||
      isActivePreviewTargetSuperseded(src, timestamp)
    ) {
      bitmap.close()
      return
    }
    cacheActivePreviewFallbackBitmap(src, timestamp, nearest.timestamp, bitmap)
  })()
    .catch(() => undefined)
    .finally(() => fallbackInflight.delete(key))
  fallbackInflight.set(key, request)
}

export function disposeScrubProxyFallback(): void {
  for (const mediaId of automaticProxyMediaIds) {
    proxyService.cancelBackgroundProxy(mediaId)
  }
  fallbackGenerationBySource.clear()
  fallbackInflight.clear()
  automaticProxyMediaIds.clear()
}
