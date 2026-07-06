import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileJson, RotateCcw, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import type { LottieItem, TimelineItem } from '@/types/timeline'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { extractLottieTextLayers, type LottieTextLayer } from '@/infrastructure/lottie/lottie-text'
import { createLogger } from '@/shared/logging/logger'
import { PropertySection, PropertyRow, NumberInput } from '../components'
import { getMixedValue } from '../utils'

const log = createLogger('lottie-section')
const MIN_SPEED = 0.1
const MAX_SPEED = 10

function isLottieItem(item: TimelineItem): item is LottieItem {
  return item.type === 'lottie'
}

/**
 * A single template-text field. Keeps a local draft while editing and commits
 * on blur/Enter so we don't rebuild the Lottie renderer on every keystroke.
 */
function TextLayerInput({
  layer,
  override,
  onCommit,
}: {
  layer: LottieTextLayer
  override: string | undefined
  onCommit: (key: string, value: string) => void
}) {
  const committed = override ?? layer.text
  const [draft, setDraft] = useState(committed)

  // Resync when the committed value changes from outside (e.g. undo).
  useEffect(() => setDraft(committed), [committed])

  const commit = () => {
    if (draft !== committed) onCommit(layer.key, draft)
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="h-7 text-xs"
      placeholder={layer.label}
      aria-label={layer.label}
    />
  )
}

/**
 * Lottie playback + template controls: speed, reverse, loop style, an in/out
 * segment, and per-layer text overrides for template animations. All fields are
 * read at render time by `mapTimelineFrameToLottieFrame` / the text patcher, so
 * edits apply identically in preview and export. Segment and text editing are
 * single-selection only (they depend on a specific animation's frames/layers).
 */
export function LottieSection({ items }: { items: TimelineItem[] }) {
  const { t } = useTranslation()
  const updateItem = useTimelineStore((s) => s.updateItem)

  const lottieItems = useMemo(() => items.filter(isLottieItem), [items])
  const ids = useMemo(() => lottieItems.map((i) => i.id), [lottieItems])
  const single = lottieItems.length === 1 ? lottieItems[0]! : null

  const patchAll = useCallback(
    (updates: Partial<LottieItem>) => {
      for (const id of ids) updateItem(id, updates)
    },
    [ids, updateItem],
  )

  const speed = getMixedValue(lottieItems, (i) => i.speed, 1)
  const reversed = getMixedValue(lottieItems, (i) => i.reversed ?? false, false)
  const loop = getMixedValue(lottieItems, (i) => i.loop ?? true, true)
  const pingpong = getMixedValue(lottieItems, (i) => (i.loopMode ?? 'loop') === 'pingpong', false)
  const loopOn = loop === true

  // Discover editable text layers for a single raw-JSON Lottie (async read).
  const [textLayers, setTextLayers] = useState<LottieTextLayer[]>([])
  const singleId = single?.id
  const singleSrc = single?.src
  useEffect(() => {
    if (!singleSrc) {
      setTextLayers([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const text = await (await fetch(singleSrc)).text()
        if (!cancelled) setTextLayers(extractLottieTextLayers(text))
      } catch (err) {
        log.warn('failed to read Lottie text layers', { error: err })
        if (!cancelled) setTextLayers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [singleId, singleSrc])

  const handleSpeedChange = useCallback(
    (value: number) => patchAll({ speed: Math.max(MIN_SPEED, Math.min(MAX_SPEED, value)) }),
    [patchAll],
  )

  const handleSegmentStart = useCallback(
    (value: number) => {
      if (!single) return
      const maxFrame = single.totalFrames - 1
      const end = single.segmentEnd ?? maxFrame
      updateItem(single.id, { segmentStart: Math.max(0, Math.min(Math.round(value), end)) })
    },
    [single, updateItem],
  )

  const handleSegmentEnd = useCallback(
    (value: number) => {
      if (!single) return
      const maxFrame = single.totalFrames - 1
      const start = single.segmentStart ?? 0
      updateItem(single.id, { segmentEnd: Math.max(start, Math.min(Math.round(value), maxFrame)) })
    },
    [single, updateItem],
  )

  const handleTextCommit = useCallback(
    (key: string, value: string) => {
      if (!single) return
      const next = { ...(single.textOverrides ?? {}) }
      const layer = textLayers.find((l) => l.key === key)
      // Drop the override when the text is reverted to the animation's original.
      if (layer && value === layer.text) delete next[key]
      else next[key] = value
      updateItem(single.id, {
        textOverrides: Object.keys(next).length > 0 ? next : undefined,
      })
    },
    [single, textLayers, updateItem],
  )

  if (lottieItems.length === 0) return null

  return (
    <PropertySection title={t('editor.lottieSection.title')} icon={FileJson} defaultOpen={true}>
      <PropertyRow label={t('editor.lottieSection.speed')}>
        <div className="flex items-center gap-1 w-full">
          <NumberInput
            value={speed}
            onChange={handleSpeedChange}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.1}
            unit="x"
            className="flex-1 min-w-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => patchAll({ speed: 1 })}
            title={t('editor.lottieSection.resetSpeed')}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.lottieSection.reverse')}>
        <Switch checked={reversed === true} onCheckedChange={(c) => patchAll({ reversed: c })} />
      </PropertyRow>

      <PropertyRow label={t('editor.lottieSection.loop')}>
        <Switch checked={loopOn} onCheckedChange={(c) => patchAll({ loop: c })} />
      </PropertyRow>

      {loopOn && (
        <PropertyRow label={t('editor.lottieSection.pingpong')}>
          <Switch
            checked={pingpong === true}
            onCheckedChange={(c) => patchAll({ loopMode: c ? 'pingpong' : 'loop' })}
          />
        </PropertyRow>
      )}

      {single && single.totalFrames > 1 && (
        <>
          <PropertyRow label={t('editor.lottieSection.trimIn')}>
            <NumberInput
              value={single.segmentStart ?? 0}
              onChange={handleSegmentStart}
              min={0}
              max={single.totalFrames - 1}
              step={1}
              className="w-full"
            />
          </PropertyRow>
          <PropertyRow label={t('editor.lottieSection.trimOut')}>
            <NumberInput
              value={single.segmentEnd ?? single.totalFrames - 1}
              onChange={handleSegmentEnd}
              min={0}
              max={single.totalFrames - 1}
              step={1}
              className="w-full"
            />
          </PropertyRow>
        </>
      )}

      {single && textLayers.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Type className="w-3 h-3" />
            {t('editor.lottieSection.text')}
          </div>
          {textLayers.map((layer) => (
            <TextLayerInput
              key={layer.key}
              layer={layer}
              override={single.textOverrides?.[layer.key]}
              onCommit={handleTextCommit}
            />
          ))}
        </div>
      )}
    </PropertySection>
  )
}
