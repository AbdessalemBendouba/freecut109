import { create } from 'zustand'
import { createLogger } from '@/shared/logging/logger'
import {
  buildLottieAttribution,
  fetchLottieAnimations,
  type LottieBrowseCategory,
  type LottieFilesAnimation,
} from '../services/lottiefiles-api'
import { useMediaLibraryStore } from '../deps/media-library'

const logger = createLogger('LottieBrowserStore')

const PAGE_SIZE = 30

type LottieBrowserStatus = 'idle' | 'loading' | 'loadingMore' | 'error'

interface LottieBrowserState {
  category: LottieBrowseCategory
  /** The committed (debounced) search query driving results. */
  query: string
  items: LottieFilesAnimation[]
  status: LottieBrowserStatus
  error: string | null
  endCursor: string | null
  hasNextPage: boolean
  totalCount: number
  /** Animations with an import in flight. */
  importingIds: Set<string>
  /** Animations already added to the media library this session. */
  importedIds: Set<string>
  /** Bumped on every fresh query so late responses can be discarded. */
  requestId: number

  setCategory: (category: LottieBrowseCategory) => void
  setQuery: (query: string) => void
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  importAnimation: (animation: LottieFilesAnimation) => Promise<void>
}

function withoutId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  next.delete(id)
  return next
}

export const useLottieBrowserStore = create<LottieBrowserState>()((set, get) => ({
  category: 'featured',
  query: '',
  items: [],
  status: 'idle',
  error: null,
  endCursor: null,
  hasNextPage: false,
  totalCount: 0,
  importingIds: new Set(),
  importedIds: new Set(),
  requestId: 0,

  setCategory: (category) => {
    if (category === get().category) return
    set({ category })
  },

  setQuery: (query) => {
    if (query === get().query) return
    set({ query })
  },

  refresh: async () => {
    const requestId = get().requestId + 1
    set({
      requestId,
      status: 'loading',
      error: null,
      items: [],
      endCursor: null,
      hasNextPage: false,
      totalCount: 0,
    })

    const { category, query } = get()
    try {
      const page = await fetchLottieAnimations({ category, query, first: PAGE_SIZE })
      if (get().requestId !== requestId) return
      set({
        items: page.items,
        endCursor: page.endCursor,
        hasNextPage: page.hasNextPage,
        totalCount: page.totalCount,
        status: 'idle',
      })
    } catch (error) {
      if (get().requestId !== requestId) return
      logger.warn('Failed to load animations', error)
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to load animations',
      })
    }
  },

  loadMore: async () => {
    const { status, hasNextPage, endCursor, category, query, requestId, items } = get()
    if (!hasNextPage || status === 'loading' || status === 'loadingMore') return

    set({ status: 'loadingMore' })
    try {
      const page = await fetchLottieAnimations({
        category,
        query,
        after: endCursor,
        first: PAGE_SIZE,
      })
      // A fresh query started while this page was in flight — drop it.
      if (get().requestId !== requestId) return
      const seen = new Set(items.map((item) => item.id))
      const merged = [...items, ...page.items.filter((item) => !seen.has(item.id))]
      set({
        items: merged,
        endCursor: page.endCursor,
        hasNextPage: page.hasNextPage,
        status: 'idle',
      })
    } catch (error) {
      if (get().requestId !== requestId) return
      logger.warn('Failed to load more animations', error)
      set({ status: 'idle' })
    }
  },

  importAnimation: async (animation) => {
    const state = get()
    if (state.importingIds.has(animation.id) || state.importedIds.has(animation.id)) return

    set({ importingIds: new Set(state.importingIds).add(animation.id) })
    try {
      const result = await useMediaLibraryStore.getState().importRemoteLottie({
        url: animation.lottieUrl,
        fileName: animation.name,
        attribution: buildLottieAttribution(animation),
      })
      set((current) => ({
        importingIds: withoutId(current.importingIds, animation.id),
        importedIds: result ? new Set(current.importedIds).add(animation.id) : current.importedIds,
      }))
    } catch (error) {
      logger.warn('Failed to import animation', error)
      set((current) => ({ importingIds: withoutId(current.importingIds, animation.id) }))
    }
  },
}))
