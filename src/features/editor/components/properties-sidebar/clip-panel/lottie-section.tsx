import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileJson, Palette, RotateCcw, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { LottieItem, TimelineItem } from '@/types/timeline'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { extractLottieTextLayers, type LottieTextLayer } from '@/infrastructure/lottie/lottie-text'
import {
  extractLottieColorLayers,
  type LottieColorLayer,
} from '@/infrastructure/lottie/lottie-color'
import {
  fetchLottieAnimation,
  fetchLottieManifest,
  parseLottieMetadata,
  readLottieMarkers,
  type LottieAnimationEntry,
  type LottieMarker,
} from '@/infrastructure/lottie/lottie-metadata'
import { resolveMediaUrl } from '@/features/editor/deps/media-library'
import { PropertySection, PropertyRow, NumberInput, ColorPicker } from '../components'
import { getMixedValue } from '../utils'

/** Sentinel Select value for "no theme" (Radix Select forbids an empty value). */
const NO_THEME = '__none__'

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

  // Discover the selected clip's editable text/color layers, named markers, and
  // (for `.lottie` archives) its bundled animations + themes.
  const [textLayers, setTextLayers] = useState<LottieTextLayer[]>([])
  const [colorLayers, setColorLayers] = useState<LottieColorLayer[]>([])
  const [markers, setMarkers] = useState<LottieMarker[]>([])
  const [animations, setAnimations] = useState<LottieAnimationEntry[]>([])
  const [themes, setThemes] = useState<string[]>([])
  const singleId = single?.id
  const singleSrc = single?.src
  const singleMediaId = single?.mediaId
  const singleAnimationId = single?.animationId

  // `item.src` can be a dead blob URL after a page reload; resolve a fresh URL
  // by mediaId first (fall back to the item's own src, e.g. items with no
  // mediaId). Shared by discovery and the animation-switch handler.
  const resolveSingleUrl = useCallback(async (): Promise<string> => {
    let url = singleSrc ?? ''
    if (singleMediaId) {
      const resolved = await resolveMediaUrl(singleMediaId).catch(() => '')
      if (resolved) url = resolved
    }
    return url
  }, [singleSrc, singleMediaId])

  useEffect(() => {
    const clear = () => {
      setTextLayers([])
      setColorLayers([])
      setMarkers([])
      setAnimations([])
      setThemes([])
    }
    if (!singleSrc && !singleMediaId) {
      clear()
      return
    }
    let cancelled = false
    void (async () => {
      const url = await resolveSingleUrl()
      if (cancelled) return
      if (!url) {
        clear()
        return
      }
      // Archive-aware: layers/markers come from the selected animation; the
      // manifest lists all bundled animations/themes (null for raw `.json`).
      const [animation, manifest] = await Promise.all([
        fetchLottieAnimation(url, false, singleAnimationId),
        fetchLottieManifest(url),
      ])
      if (cancelled) return
      setTextLayers(animation ? extractLottieTextLayers(animation) : [])
      setColorLayers(animation ? extractLottieColorLayers(animation) : [])
      setMarkers(animation ? readLottieMarkers(animation) : [])
      setAnimations(manifest?.animations ?? [])
      setThemes(manifest?.themes ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [singleId, singleSrc, singleMediaId, singleAnimationId, resolveSingleUrl])

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

  // The animation that plays by default is the manifest's first; a stored
  // `animationId` overrides it.
  const effectiveAnimationId = single?.animationId ?? animations[0]?.id

  const handleAnimationChange = useCallback(
    (animationId: string) => {
      if (!single || animationId === effectiveAnimationId) return
      void (async () => {
        const url = await resolveSingleUrl()
        const animation = url ? await fetchLottieAnimation(url, false, animationId) : null
        const meta = animation ? parseLottieMetadata(animation) : null
        updateItem(single.id, {
          animationId,
          // A different animation has its own frames/slots — drop frame-indexed
          // edits and re-derive timing/size from the chosen animation.
          segmentStart: undefined,
          segmentEnd: undefined,
          textOverrides: undefined,
          colorOverrides: undefined,
          ...(meta
            ? {
                frameRate: meta.frameRate,
                totalFrames: meta.totalFrames,
                sourceWidth: meta.width,
                sourceHeight: meta.height,
              }
            : {}),
        })
      })()
    },
    [single, effectiveAnimationId, resolveSingleUrl, updateItem],
  )

  const handleThemeChange = useCallback(
    (value: string) => {
      if (single) updateItem(single.id, { themeId: value === NO_THEME ? undefined : value })
    },
    [single, updateItem],
  )

  // Apply a named marker as the active segment. A zero-duration marker (a cue
  // point) plays from the marker to the end.
  const handleMarkerSelect = useCallback(
    (name: string) => {
      if (!single) return
      const marker = markers.find((m) => m.name === name)
      if (!marker) return
      const maxFrame = single.totalFrames - 1
      const start = Math.max(0, Math.min(Math.round(marker.start), maxFrame))
      const end =
        marker.duration > 0
          ? Math.max(start, Math.min(Math.round(marker.start + marker.duration), maxFrame))
          : maxFrame
      updateItem(single.id, { segmentStart: start, segmentEnd: end })
    },
    [single, markers, updateItem],
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

  // Group the extracted colors by their original value so a color shared across
  // multiple shapes is a single editable swatch (a palette): recoloring it
  // updates every shape that used it. Overrides are still stored per instance.
  const colorGroups = useMemo(() => {
    const byOriginal = new Map<string, { keys: string[]; label: string }>()
    for (const layer of colorLayers) {
      const group = byOriginal.get(layer.color)
      if (group) group.keys.push(layer.key)
      else byOriginal.set(layer.color, { keys: [layer.key], label: layer.label })
    }
    return Array.from(byOriginal, ([original, { keys, label }]) => ({
      original,
      keys,
      label: keys.length > 1 ? t('editor.lottieSection.colorGroup', { count: keys.length }) : label,
    }))
  }, [colorLayers, t])

  const commitColorGroup = useCallback(
    (keys: string[], original: string, value: string) => {
      if (!single) return
      const next = { ...(single.colorOverrides ?? {}) }
      // Reverting to the original color drops the override for every shape.
      const revert = value.toLowerCase() === original.toLowerCase()
      for (const key of keys) {
        if (revert) delete next[key]
        else next[key] = value
      }
      updateItem(single.id, {
        colorOverrides: Object.keys(next).length > 0 ? next : undefined,
      })
    },
    [single, updateItem],
  )

  const resetAllColors = useCallback(() => {
    if (single) updateItem(single.id, { colorOverrides: undefined })
  }, [single, updateItem])

  const hasColorOverrides =
    !!single?.colorOverrides && Object.keys(single.colorOverrides).length > 0

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

      {single && animations.length > 1 && (
        <PropertyRow label={t('editor.lottieSection.animation')}>
          <Select value={effectiveAnimationId} onValueChange={handleAnimationChange}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {animations.map((a, i) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  {a.id || t('editor.lottieSection.animationN', { index: i + 1 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>
      )}

      {single && themes.length > 0 && (
        <PropertyRow label={t('editor.lottieSection.theme')}>
          <Select value={single.themeId ?? NO_THEME} onValueChange={handleThemeChange}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_THEME} className="text-xs">
                {t('editor.lottieSection.themeNone')}
              </SelectItem>
              {themes.map((id) => (
                <SelectItem key={id} value={id} className="text-xs">
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyRow>
      )}

      {single && single.totalFrames > 1 && (
        <>
          {markers.length > 0 && (
            <PropertyRow label={t('editor.lottieSection.marker')}>
              <Select onValueChange={handleMarkerSelect}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder={t('editor.lottieSection.markerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {markers.map((m) => (
                    <SelectItem key={m.name} value={m.name} className="text-xs">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>
          )}
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

      {single && colorGroups.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Palette className="w-3 h-3" />
              {t('editor.lottieSection.colors')}
            </div>
            {hasColorOverrides && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-muted-foreground"
                onClick={resetAllColors}
              >
                {t('editor.lottieSection.resetColors')}
              </Button>
            )}
          </div>
          {colorGroups.map((group) => (
            <ColorPicker
              key={group.original}
              label={group.label}
              color={single.colorOverrides?.[group.keys[0]!] ?? group.original}
              defaultColor={group.original}
              onChange={(c) => commitColorGroup(group.keys, group.original, c)}
              onReset={() => commitColorGroup(group.keys, group.original, group.original)}
            />
          ))}
        </div>
      )}
    </PropertySection>
  )
}
