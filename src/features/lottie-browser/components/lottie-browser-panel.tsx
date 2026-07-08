import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/shared/ui/cn'
import type { LottieBrowseCategory } from '../services/lottiefiles-api'
import { useLottieBrowserStore } from '../stores/lottie-browser-store'
import { LottieCard } from './lottie-card'

const CATEGORIES: LottieBrowseCategory[] = ['featured', 'popular', 'recent']

function LottieBrowserPanelComponent() {
  const { t } = useTranslation()

  const category = useLottieBrowserStore((s) => s.category)
  const query = useLottieBrowserStore((s) => s.query)
  const items = useLottieBrowserStore((s) => s.items)
  const status = useLottieBrowserStore((s) => s.status)
  const error = useLottieBrowserStore((s) => s.error)
  const hasNextPage = useLottieBrowserStore((s) => s.hasNextPage)
  const importingIds = useLottieBrowserStore((s) => s.importingIds)
  const importedIds = useLottieBrowserStore((s) => s.importedIds)

  const setCategory = useLottieBrowserStore((s) => s.setCategory)
  const setQuery = useLottieBrowserStore((s) => s.setQuery)
  const refresh = useLottieBrowserStore((s) => s.refresh)
  const loadMore = useLottieBrowserStore((s) => s.loadMore)
  const importAnimation = useLottieBrowserStore((s) => s.importAnimation)

  const [inputValue, setInputValue] = useState(query)
  const isSearching = inputValue.trim().length > 0

  // Debounce the search box into the committed query.
  useEffect(() => {
    const id = window.setTimeout(() => setQuery(inputValue.trim()), 300)
    return () => window.clearTimeout(id)
  }, [inputValue, setQuery])

  // (Re)load whenever the feed or committed query changes — also runs on mount.
  useEffect(() => {
    void refresh()
  }, [category, query, refresh])

  // Infinite scroll: load the next page as the sentinel nears the viewport.
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root, rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  const isInitialLoading = status === 'loading'
  const showEmpty = status === 'idle' && items.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* Search + feed controls */}
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder={t('lottieBrowser.searchPlaceholder')}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {inputValue.length > 0 && (
            <button
              type="button"
              onClick={() => setInputValue('')}
              aria-label={t('lottieBrowser.clearSearch')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {!isSearching && (
          <div className="flex gap-1">
            {CATEGORIES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                  category === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {t(`lottieBrowser.categories.${id}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {isInitialLoading && (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-muted-foreground">{error ?? t('lottieBrowser.error')}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md bg-secondary px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary/80"
            >
              {t('lottieBrowser.retry')}
            </button>
          </div>
        )}

        {showEmpty && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {t('lottieBrowser.empty')}
          </p>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {items.map((animation) => (
              <LottieCard
                key={animation.id}
                animation={animation}
                isImporting={importingIds.has(animation.id)}
                isImported={importedIds.has(animation.id)}
                onImport={importAnimation}
              />
            ))}
          </div>
        )}

        {status === 'loadingMore' && (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {/* Infinite-scroll sentinel */}
        {hasNextPage && <div ref={sentinelRef} className="h-px w-full" />}
      </div>

      {/* Attribution / licensing note */}
      <div className="border-t border-border px-3 py-2">
        <p className="text-[10px] leading-tight text-muted-foreground">
          {t('lottieBrowser.attributionNote')}
        </p>
      </div>
    </div>
  )
}

export const LottieBrowserPanel = memo(LottieBrowserPanelComponent)
