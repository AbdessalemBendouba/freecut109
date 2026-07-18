import { useEffect, useRef, useState } from 'react'
import { Link2, Unlink2 } from 'lucide-react'

function AxisInput({
  axis,
  value,
  unit,
  propertyLabel,
  disabled,
  allowCreateOnBlur,
  onCommit,
}: {
  axis: 'x' | 'y'
  value: number
  unit: string
  propertyLabel: string
  disabled: boolean
  allowCreateOnBlur: boolean
  onCommit: (value: number, options: { allowCreate: boolean }) => boolean | void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const skipNextBlurCommitRef = useRef(false)
  const [draft, setDraft] = useState(() => value.toFixed(2))

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value.toFixed(2))
  }, [value])

  const commit = (allowCreate: boolean) => {
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) {
      if (parsed !== value) {
        const applied = onCommit(parsed, { allowCreate })
        if (applied === false) setDraft(value.toFixed(2))
      }
    }
    else setDraft(value.toFixed(2))
  }

  return (
    <label
      className={`flex h-5 min-w-0 flex-1 items-center bg-background/85 px-1 text-[9px] ${
        axis === 'y' ? 'border-l border-border/70' : ''
      }`}
    >
      <span className="mr-1 text-muted-foreground">{axis.toUpperCase()}</span>
      <input
        ref={inputRef}
        aria-label={`${propertyLabel} ${axis.toUpperCase()}`}
        className="min-w-0 flex-1 bg-transparent text-right font-mono text-[9px] tabular-nums outline-none disabled:opacity-50"
        disabled={disabled}
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false
            return
          }
          commit(allowCreateOnBlur)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            skipNextBlurCommitRef.current = true
            commit(true)
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            skipNextBlurCommitRef.current = true
            setDraft(value.toFixed(2))
            event.currentTarget.blur()
          }
        }}
      />
      <span className="ml-0.5 text-muted-foreground">{unit}</span>
    </label>
  )
}

export interface CompoundPropertyInputConfig {
  label: string
  value: { x: number; y: number }
  preExpressionValue?: { x: number; y: number }
  unit: string
  /** Vector2 property exposed by the row's Property Link pick whip. */
  linkProperty?: import('@/types/keyframe').VectorAnimatableProperty
  linked?: boolean
  disabled?: boolean
  allowCreateOnBlur?: boolean
  axisLink?: {
    linked: boolean
    onChange: (linked: boolean) => void
  }
  onCommit: (
    axis: 'x' | 'y',
    value: number,
    options: { allowCreate: boolean },
  ) => boolean | void
}

export function CompoundPropertyInputs({
  config,
  spacious = false,
}: {
  config: CompoundPropertyInputConfig
  spacious?: boolean
}) {
  return (
    <div
      className={`flex shrink-0 items-center overflow-hidden rounded-sm border border-border/70 ${
        spacious ? 'w-[192px]' : 'w-[116px]'
      } ${
        config.linked ? 'border-orange-500/50 text-orange-400' : ''
      }`}
      data-testid="compound-property-inputs"
    >
      {config.axisLink ? (
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center border-r border-border/70 text-muted-foreground hover:text-foreground"
          aria-label={config.axisLink.linked ? `Unlink ${config.label} axes` : `Link ${config.label} axes`}
          aria-pressed={config.axisLink.linked}
          onClick={() => config.axisLink?.onChange(!config.axisLink.linked)}
        >
          {config.axisLink.linked ? (
            <Link2 className="h-2.5 w-2.5" />
          ) : (
            <Unlink2 className="h-2.5 w-2.5" />
          )}
        </button>
      ) : spacious ? (
        <span
          aria-hidden="true"
          className="h-5 w-5 shrink-0 border-r border-border/70"
          data-testid="compound-property-axis-link-spacer"
        />
      ) : null}
      <AxisInput
        axis="x"
        value={config.value.x}
        unit={config.unit}
        propertyLabel={config.label}
        disabled={config.disabled ?? false}
        allowCreateOnBlur={config.allowCreateOnBlur ?? false}
        onCommit={(value, options) => config.onCommit('x', value, options)}
      />
      <AxisInput
        axis="y"
        value={config.value.y}
        unit={config.unit}
        propertyLabel={config.label}
        disabled={config.disabled ?? false}
        allowCreateOnBlur={config.allowCreateOnBlur ?? false}
        onCommit={(value, options) => config.onCommit('y', value, options)}
      />
    </div>
  )
}
