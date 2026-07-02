import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { applyEasingConfig } from '@/shared/utils/easing'
import {
  DEFAULT_SPRING_PARAMS,
  type BezierControlPoints,
  type EasingConfig,
  type EasingType,
  type SpringParameters,
} from '@/types/keyframe'

import { effectiveBezier } from './easings-dev-presets'

/**
 * The easing editor, adapted from easings.dev: a curve canvas on the left, and
 * parameter slider+number rows plus a `Duration` row and a moving-dot Position
 * Preview on the right. For a cubic-bezier easing the rows are `x1 / y1 / x2 /
 * y2`; for a spring they are `tension / friction / mass`. Both the canvas and
 * the preview evaluate the real `EasingConfig`, so a spring shows its actual
 * bounce (not the linear diagonal a spring collapses to as a bezier).
 *
 * `Duration` drives only the preview playback (it is not stored on the keyframe
 * — a segment's real duration is the gap between its two keyframes).
 */

type BezierKey = keyof BezierControlPoints

const BEZIER_INPUT_KEYS = ['x1', 'y1', 'x2', 'y2'] as const
const SPRING_INPUT_KEYS = ['tension', 'friction', 'mass'] as const
type SpringKey = (typeof SPRING_INPUT_KEYS)[number]

// Canvas geometry (px). Vertical headroom shows overshoot/anticipation.
const SIZE = 176
const PAD = 16
const PLOT = SIZE - PAD * 2
const Y_MIN = -0.7
const Y_MAX = 1.7

const xToPx = (x: number) => PAD + x * PLOT
const yToPx = (y: number) => PAD + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * PLOT

const FIELD_RANGE: Record<BezierKey, { min: number; max: number }> = {
  x1: { min: 0, max: 1 },
  y1: { min: -1, max: 2 },
  x2: { min: 0, max: 1 },
  y2: { min: -1, max: 2 },
}

// Ranges wide enough for every catalog spring (e.g. tension up to 1000, mass up
// to 10). Clamps live here so the editor stays self-contained, mirroring the
// bezier `FIELD_RANGE` above. `decimals` keeps the readout faithful to fractional
// preset values (e.g. Bob's friction 2.3) rather than rounding them away.
const SPRING_FIELD_RANGE: Record<
  SpringKey,
  { min: number; max: number; step: number; decimals: number }
> = {
  tension: { min: 1, max: 1000, step: 1, decimals: 1 },
  friction: { min: 1, max: 100, step: 1, decimals: 1 },
  mass: { min: 0.1, max: 10, step: 0.1, decimals: 2 },
}

function clampField(key: BezierKey, value: number): number {
  const { min, max } = FIELD_RANGE[key]
  return Math.max(min, Math.min(max, value))
}

function clampSpringField(key: SpringKey, value: number): number {
  const { min, max } = SPRING_FIELD_RANGE[key]
  return Math.max(min, Math.min(max, value))
}

function curvePath(config: EasingConfig): string {
  // For a cubic-bezier, trace the true parametric control-point curve so the
  // handles' shape reads correctly. Everything else (springs) has no bezier
  // form — sample the eased value against uniform time instead.
  if (config.type === 'cubic-bezier' && config.bezier) {
    const { x1, y1, x2, y2 } = config.bezier
    const steps = 48
    let d = `M ${xToPx(0)} ${yToPx(0)}`
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const mt = 1 - t
      const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t
      const y = 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t
      d += ` L ${xToPx(x)} ${yToPx(y)}`
    }
    return d
  }

  const steps = 64
  let d = `M ${xToPx(0)} ${yToPx(applyEasingConfig(0, config))}`
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    d += ` L ${xToPx(t)} ${yToPx(applyEasingConfig(t, config))}`
  }
  return d
}

interface EasingCurveEditorProps {
  /** The segment's easing type (drives whether bezier or spring rows show). */
  easing: EasingType
  /** The segment's easing config (spring params / bezier points). */
  config: EasingConfig | undefined
  /** `commit` is false for live slider drag, true for discrete edits. */
  onChangeBezier: (bezier: BezierControlPoints, commit: boolean) => void
  /** `commit` is false for live slider drag, true for discrete edits. */
  onChangeSpring: (spring: SpringParameters, commit: boolean) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function EasingCurveEditor({
  easing,
  config,
  onChangeBezier,
  onChangeSpring,
  onDragStart,
  onDragEnd,
}: EasingCurveEditorProps) {
  const { t } = useTranslation()
  const [duration, setDuration] = useState(1)

  const isSpring = easing === 'spring'
  const bezier = effectiveBezier(easing, config)
  const spring = config?.type === 'spring' && config.spring ? config.spring : DEFAULT_SPRING_PARAMS
  const previewConfig: EasingConfig = isSpring
    ? { type: 'spring', spring }
    : { type: 'cubic-bezier', bezier }

  const setBezierField = useCallback(
    (key: BezierKey, raw: number, commit: boolean) => {
      onChangeBezier({ ...bezier, [key]: clampField(key, raw) }, commit)
    },
    [onChangeBezier, bezier],
  )

  const setSpringField = useCallback(
    (key: SpringKey, raw: number, commit: boolean) => {
      onChangeSpring({ ...spring, [key]: clampSpringField(key, raw) }, commit)
    },
    [onChangeSpring, spring],
  )

  return (
    <div className="flex gap-3">
      <CurveCanvas config={previewConfig} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {isSpring
          ? SPRING_INPUT_KEYS.map((key) => (
              <SliderRow
                key={key}
                label={key}
                value={spring[key]}
                min={SPRING_FIELD_RANGE[key].min}
                max={SPRING_FIELD_RANGE[key].max}
                step={SPRING_FIELD_RANGE[key].step}
                decimals={SPRING_FIELD_RANGE[key].decimals}
                onLive={(v) => setSpringField(key, v, false)}
                onCommit={(v) => setSpringField(key, v, true)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))
          : BEZIER_INPUT_KEYS.map((key) => (
              <SliderRow
                key={key}
                label={key}
                value={bezier[key]}
                min={FIELD_RANGE[key].min}
                max={FIELD_RANGE[key].max}
                step={0.01}
                onLive={(v) => setBezierField(key, v, false)}
                onCommit={(v) => setBezierField(key, v, true)}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
        <SliderRow
          label={t('timeline.keyframeEditor.duration', { defaultValue: 'Duration' })}
          value={duration}
          min={0.2}
          max={3}
          step={0.1}
          onLive={setDuration}
          onCommit={setDuration}
        />

        <PositionPreview config={previewConfig} duration={duration} />
      </div>
    </div>
  )
}

function CurveCanvas({ config }: { config: EasingConfig }) {
  const dots: string[] = []
  for (let gx = 0; gx <= 8; gx++) {
    for (let gy = 0; gy <= 8; gy++) {
      dots.push(`${PAD + (gx / 8) * PLOT},${PAD + (gy / 8) * PLOT}`)
    }
  }
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="shrink-0 rounded-md border border-border/60 bg-black/40"
      aria-hidden
    >
      {dots.map((d) => {
        const [cx, cy] = d.split(',')
        return <circle key={d} cx={cx} cy={cy} r={0.7} className="fill-white/15" />
      })}
      <line
        x1={xToPx(0)}
        y1={yToPx(0)}
        x2={xToPx(1)}
        y2={yToPx(1)}
        className="stroke-white/10"
        strokeWidth={1}
      />
      <path d={curvePath(config)} className="fill-none stroke-white" strokeWidth={2} />
      <circle cx={xToPx(0)} cy={yToPx(0)} r={2.5} className="fill-white/70" />
      <circle cx={xToPx(1)} cy={yToPx(1)} r={2.5} className="fill-white/70" />
    </svg>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  decimals = 2,
  onLive,
  onCommit,
  onDragStart,
  onDragEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onLive: (value: number) => void
  onCommit: (value: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commitDraft = useCallback(() => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (Number.isFinite(parsed)) onCommit(parsed)
  }, [draft, onCommit])

  return (
    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span className="w-14 shrink-0 lowercase">{label}</span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onPointerDown={onDragStart}
        onValueChange={(values) => onLive(values[0] ?? value)}
        onValueCommit={() => onDragEnd?.()}
        className="min-w-0 flex-1"
        aria-label={label}
      />
      <Input
        value={draft ?? value.toFixed(decimals)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
        className="h-6 w-14 shrink-0 px-1.5 text-center text-[11px] tabular-nums"
        inputMode="decimal"
      />
    </label>
  )
}

function PositionPreview({
  config,
  duration,
}: {
  config: EasingConfig
  duration: number
}) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(true)
  const [pos, setPos] = useState(0)
  const configRef = useRef(config)
  configRef.current = config
  const durationRef = useRef(duration)
  durationRef.current = duration

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let start = performance.now()
    const tick = (now: number) => {
      const tau = ((now - start) / 1000 / durationRef.current) % 1
      if (tau < 0) start = now
      setPos(applyEasingConfig(tau, configRef.current))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{t('timeline.keyframeEditor.positionPreview', { defaultValue: 'Position Preview' })}</span>
        <button
          type="button"
          className="rounded px-1 hover:text-foreground"
          onClick={() => setPlaying((p) => !p)}
        >
          {playing
            ? t('timeline.keyframeEditor.pause', { defaultValue: 'Pause' })
            : t('timeline.keyframeEditor.play', { defaultValue: 'Play' })}
        </button>
      </div>
      <div className="relative h-9 overflow-hidden rounded-md border border-border/60 bg-black/40">
        <div className="absolute inset-x-3 top-1/2 border-t border-dashed border-white/20" />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-orange-400"
          style={{ left: `calc(12px + (100% - 24px) * ${Math.max(0, Math.min(1, pos))} - 7px)` }}
        />
      </div>
    </div>
  )
}
