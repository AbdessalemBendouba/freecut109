/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Braces,
  LineChart,
  Lock,
  Sparkles,
  Timer,
  Unlink,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingType,
  Keyframe,
  KeyframeRef,
  DirectLinkableProperty,
  DirectPropertyLink,
  PropertyExpression,
} from '@/types/keyframe'
import {
  isDirectLinkableProperty,
  isEffectAnimatableProperty,
  isLinkableAnimatableProperty,
} from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout'
import { CompactNavigator } from './compact-navigator'
import { DopesheetClipboardActions } from './dopesheet-clipboard-actions'
import { DopesheetEditActions } from './dopesheet-edit-actions'
import { DopesheetGraphPane } from './dopesheet-graph-pane'
import { useGraphViewState } from './use-graph-view-state'
import { useGroupExpansion } from './use-group-expansion'
import { useHeaderFrameInputs } from './use-header-frame-inputs'
import { usePropertyFilters } from './use-property-filters'
import { useDopesheetMarquee } from './use-dopesheet-marquee'
import { useTimingStripDrag } from './use-timing-strip-drag'
import { useDopesheetViewport } from './use-dopesheet-viewport'
import { useElementSize } from './use-element-size'
import { addWindowPointerListeners } from './dopesheet-pointer-listeners'
import { DopesheetHeaderFrameInputs } from './dopesheet-header-frame-inputs'
import { DopesheetRulerHeader } from './dopesheet-ruler-header'
import { DopesheetSheetBody } from './dopesheet-sheet-body'
import { DopesheetInterpolationButtons } from './dopesheet-interpolation-buttons'
import { DopesheetParameterMenu } from './dopesheet-parameter-menu'
import { DopesheetLegendPopover } from './dopesheet-legend-popover'
import { DopesheetViewOptionsMenu } from './dopesheet-view-options-menu'
import {
  CompoundPropertyInputs,
  type CompoundPropertyInputConfig,
} from './compound-property-inputs'
import { KeyframeTimingStrip } from './keyframe-timing-strip'
import { PickWhipIcon } from './pick-whip-icon'
import { setPointerCaptureSafely } from './dopesheet-utils'
import { useMotionPickWhipDrag } from '@/shared/hooks/use-pick-whip-drag'
import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'
import {
  evaluatePropertyExpression,
  isExpressionValueCompatible,
  type ExpressionValue,
} from '@/features/keyframes/utils/property-expression'
import {
  arePreviewFramesEqual,
  buildGroupedPropertyRows,
  buildGroupedPropertyStructure,
  getNiceTickStep,
} from './dopesheet-helpers'
import type { DopesheetPropertyGroupStructure } from './dopesheet-helpers'
import { GroupTimelineCell, PropertyTimelineCell } from './dopesheet-timeline-cells'
import type { SegmentEasingChange } from './segment-easing-popover'
import { DopesheetPlayheadLine } from './dopesheet-playhead-line'
import {
  DRAG_THRESHOLD,
  EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
  GROUP_HEADER_HEIGHT,
  MINI_ICON_BUTTON_CLASS,
  MINI_ICON_CLASS,
  PROPERTY_COLUMN_WIDTH,
  SPACIOUS_PROPERTY_COLUMN_WIDTH,
  ROW_HEIGHT,
  SNAP_THRESHOLD_PX,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from './dopesheet-constants'
import type {
  DopesheetPropertyGroup,
  DopesheetPropertyRow,
  DragState,
  KeyframeMeta,
  RenderedSheetEntry,
  Viewport,
} from './dopesheet-types'
import { getDopesheetRowControlState } from './row-controls'
import { getPropertyAccordionGroups } from './property-groups'
import { getCombinedGraphValueRange } from '../value-graph-editor/value-range-utils'
import {
  PROPERTY_VALUE_RANGES,
  isColorAnimatableProperty,
} from '@/features/keyframes/property-value-ranges'
import {
  colorStringToKeyframeValue,
  keyframeValueToHexColor,
} from '@/features/keyframes/utils/color-keyframes'
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints'
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store'
import { useItemsStore } from '@/features/keyframes/deps/timeline'
import {
  getProceduralBands,
  type ProceduralPreviewInput,
} from '@/features/keyframes/utils/procedural-preview'
import { clampFrame } from './frame-utils'
import {
  buildSelectionFramePreview as buildSelectionFramePreviewState,
  commitSelectionFramePreview as commitSelectionFramePreviewState,
  duplicateSelectionFramePreview as duplicateSelectionFramePreviewState,
} from './selection-frame-actions'
import {
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  removeSelectionIds,
} from './row-action-helpers'
import {
  getKeyframeGroupLabel,
  getKeyframePropertyLabel,
  getKeyframePropertyShortLabel,
} from '@/features/keyframes/utils/property-i18n'
import { useCoalescedScrub } from '../use-coalesced-scrub'
import { getScrubbedPropertyValue } from './property-value-scrub'

interface DopesheetEditorProps {
  /** Shared time viewport when split mode needs synchronized frame zoom/pan */
  frameViewport?: Viewport
  /** Callback when the shared time viewport changes */
  onFrameViewportChange?: (viewport: Viewport) => void
  /** Item ID to show keyframes for */
  itemId: string
  /** Keyframes organized by property */
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  /** Currently selected property (or null to show all) */
  selectedProperty?: AnimatableProperty | null
  /** Selected keyframe IDs */
  selectedKeyframeIds?: Set<string>
  /** Current playhead frame */
  currentFrame?: number
  /** Global timeline frame for the same playhead position */
  globalFrame?: number | null
  /** Absolute timeline frame where the edited item starts (for live playhead) */
  itemFrom?: number
  /** Total duration in frames */
  totalFrames?: number
  /** Timeline FPS used for ruler display */
  fps?: number
  /** Width of the editor */
  width?: number
  /** Height of the editor */
  height?: number
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  /** Callback when bezier handles are moved in graph view */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void
  /**
   * Apply an easing change to explicit keyframe refs from the sheet's per-segment
   * easing popover. `commit: false` = live (no undo) drag frame; the default
   * commits with undo. Live drags are bracketed by `onDragStart`/`onDragEnd`.
   */
  onSegmentEasingChange?: SegmentEasingChange
  /** Callback when selection changes */
  onSelectionChange?: (
    keyframeIds: Set<string>,
    options?: { preserveExternalSelection?: boolean },
  ) => void
  /** Additional absolute composition frames considered by keyframe snapping. */
  additionalSnapFrames?: readonly number[]
  /**
   * Lets an embedding composition surface move a selection spanning multiple
   * items as one transaction. Return true when the embedding surface handled
   * the preview or commit.
   */
  onSelectionFrameDelta?: (deltaFrames: number, phase: 'preview' | 'commit' | 'cancel') => boolean
  /** Callback when property selection changes */
  onPropertyChange?: (property: AnimatableProperty | null) => void
  /** Notify an embedding surface when a property's inline curve is shown or hidden. */
  onCurveVisibilityChange?: (property: AnimatableProperty, visible: boolean) => void
  /** Callback when a property row becomes the active interaction target */
  onActivePropertyChange?: (property: AnimatableProperty) => void
  /** Callback when playhead is scrubbed (frame is clip-relative) */
  onScrub?: (frame: number) => void
  /** Callback when scrubbing starts */
  onScrubStart?: () => void
  /** Callback when scrubbing ends */
  onScrubEnd?: () => void
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void
  /** Callback when pointer cancellation discards an in-progress drag. */
  onDragCancel?: () => void
  /** Callback to add a keyframe at the current frame */
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void
  /** Callback to duplicate keyframes to explicit target frames */
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
  /** Current property values at the playhead */
  propertyValues?: Partial<Record<AnimatableProperty, number>>
  /** Scalar source rows hidden because a compound row represents them together. */
  hiddenPropertyRows?: readonly AnimatableProperty[]
  /** Integrated two-axis row configuration keyed by its primary timeline property. */
  compoundPropertyRows?: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>>
  /** Secondary value curve rendered with its compound primary row in Value mode. */
  compoundSecondaryProperties?: Partial<Record<AnimatableProperty, AnimatableProperty>>
  /** Callback to commit a property value at the playhead */
  onPropertyValueCommit?: (
    property: AnimatableProperty,
    value: number,
    options?: { allowCreate?: boolean },
  ) => void
  /** Live no-undo value updates used while horizontally scrubbing an input. */
  onPropertyValuePreview?: (property: AnimatableProperty, value: number) => void
  /** Existing post-keyframe direct property links for this item. */
  propertyLinks?: readonly DirectPropertyLink[]
  /** Human-readable source labels keyed by target property. */
  propertyLinkSourceLabels?: Partial<Record<DirectLinkableProperty, string>>
  /** Begin an AE-style pick-whip drag from a target property. */
  onPropertyLinkPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  /** Remove a direct property link while preserving authored keyframes. */
  onRemovePropertyLink?: (property: DirectLinkableProperty) => void
  /** @deprecated Use propertyLinks. */
  linkedTransformExpressions?: readonly DirectPropertyLink[]
  /** @deprecated Use propertyLinkSourceLabels. */
  linkedTransformSourceLabels?: Partial<Record<DirectLinkableProperty, string>>
  /** @deprecated Use onPropertyLinkPointerDown. */
  onLinkedTransformPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  /** @deprecated Use onRemovePropertyLink. */
  onRemoveLinkedTransform?: (property: DirectLinkableProperty) => void
  /** Sandboxed expressions keyed by their target property. */
  propertyExpressions?: readonly PropertyExpression[]
  /** Values after keyframes/direct links but before expressions. */
  preExpressionPropertyValues?: Partial<Record<AnimatableProperty, number>>
  /** Resolve references used by expression previews and error reporting. */
  resolveExpressionReference?: (
    itemId: string,
    property: DirectLinkableProperty,
  ) => ExpressionValue | null
  /** Create or update a sandboxed property expression. */
  onSetPropertyExpression?: (
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  /** Remove a sandboxed property expression. */
  onRemovePropertyExpression?: (property: DirectLinkableProperty) => void
  /** Reset effect parameters to their definition defaults and clear their keyframes. */
  onResetPropertiesToDefault?: (properties: AnimatableProperty[]) => void
  /** Callback to remove selected keyframes */
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
  /** Copy selected keyframes */
  onCopyKeyframes?: () => void
  /** Cut selected keyframes */
  onCutKeyframes?: () => void
  /** Paste keyframes from clipboard */
  onPasteKeyframes?: () => void
  /** Whether clipboard currently contains keyframes */
  hasKeyframeClipboard?: boolean
  /** Whether clipboard represents a cut operation */
  isKeyframeClipboardCut?: boolean
  /** Selected interpolation/easing for the current editor selection */
  selectedInterpolation?: EasingType
  /** Available interpolation options */
  interpolationOptions?: ReadonlyArray<{ value: EasingType; label: string }>
  /** Callback when the selection interpolation changes */
  onInterpolationChange?: (easing: EasingType) => void
  /** Disable interpolation control */
  interpolationDisabled?: boolean
  /** Callback to navigate to a keyframe */
  onNavigateToKeyframe?: (frame: number) => void
  /** Transition-blocked frame ranges (keyframes cannot be placed here) */
  transitionBlockedRanges?: BlockedFrameRange[]
  /** Procedural generator inputs for dashed ghost curves in the graph. */
  proceduralPreview?: ProceduralPreviewInput
  /** Whether the edited clip carries bakeable procedural motion. */
  canBakeMotion?: boolean
  /** Flatten the clip's procedural motion into editable keyframes. */
  onBakeMotion?: () => void
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Which visualization to render on the right side. `split` shows both the
   *  sheet body and the curve/graph pane at once (Animate workspace placement),
   *  sharing a single frame viewport and playhead so they cannot desync. */
  visualizationMode?: 'dopesheet' | 'graph' | 'split'
  /** Main graph semantics for compound vector properties. */
  graphMode?: 'value' | 'speed'
  /** Switch the main graph between authored values and temporal velocity. */
  onGraphModeChange?: (mode: 'value' | 'speed') => void
  /** Replaces the value graph canvas when graphMode is speed. */
  speedGraphContent?: ReactNode
  /** Use the wider property column + value inputs (Animate workspace, where
   *  there is room). Defaults to the compact sidebar sizing. */
  spacious?: boolean
  /** Render selected property groups as direct rows in the graph property column. */
  inlinePropertyGroupIds?: readonly string[]
  /** Render only property/keyframe rows for embedding beneath another surface's header. */
  presentation?: 'editor' | 'lanes'
  /** Override the property column width when embedding lane rows. */
  propertyColumnWidth?: number
  /** Show one selected property curve at a time instead of layered graph curves. */
  singleCurveMode?: boolean
  /** Keep the selected curve toggle visually active when its graph is rendered
   *  by an external pane rather than this editor's own right side. */
  selectedCurveVisibleExternally?: boolean
  /** Optional controlled property filter for embedded lane presentations. */
  propertyFilter?: 'all' | 'keyframed'
  /** Absolute frame where a generated procedural band begins. */
  proceduralFrameOffset?: number
  /** Duration used for generated procedural bands. Defaults to the editor range. */
  proceduralDurationInFrames?: number
  /** Parameter groups visible when this editor instance first opens. */
  initialVisibleGroupIds?: readonly string[]
  /** Render the playhead. Disable it when the parent owns one shared overlay. */
  showPlayhead?: boolean
  /** Activate editor-only shortcuts when this surface owns pointer or keyboard focus. */
  shortcutsEnabled?: boolean
  /** User-configurable bindings for high-frequency keyframe actions. */
  shortcuts?: {
    toggleKeyframe: string
    previousKeyframe: string
    nextKeyframe: string
    toggleAutoKey: string
    fitKeyframes: string
  }
  /** Additional class name */
  className?: string
}

type StructureRow = { property: AnimatableProperty; keyframes: Keyframe[] }

// Stable empty fallbacks so memoized timeline cells don't see fresh `[]` refs.
const EMPTY_KEYFRAMES: Keyframe[] = []
const EMPTY_STRUCTURE_ROWS: StructureRow[] = []
const EMPTY_PROPERTY_GROUP_IDS: readonly string[] = []
const EMPTY_HIDDEN_PROPERTIES: readonly AnimatableProperty[] = []
const EMPTY_COMPOUND_ROWS: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>> = {}
const EMPTY_COMPOUND_SECONDARIES: Partial<Record<AnimatableProperty, AnimatableProperty>> = {}

interface ExpressionReferenceDragOrigin {
  itemId: string
  property: DirectLinkableProperty
  selectionStart: number
  selectionEnd: number
}

interface ExpressionReferenceCandidate {
  itemId: string
  property: DirectLinkableProperty
}

function resolveExpressionReferenceCandidate(
  clientX: number,
  clientY: number,
  origin: ExpressionReferenceDragOrigin,
) {
  const element = document.elementFromPoint(clientX, clientY)
  const row = element?.closest<HTMLElement>('[data-expression-item-id][data-expression-property]')
  const itemId = row?.dataset.expressionItemId
  const property = row?.dataset.expressionProperty
  if (!row || !itemId || !property || !isDirectLinkableProperty(property)) return null
  if (itemId === origin.itemId && property === origin.property) return null
  return { row, value: { itemId, property } }
}

function formatExpressionValue(value: ExpressionValue | undefined): string {
  if (value === undefined) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '—'
  return `[${value.x.toFixed(2)}, ${value.y.toFixed(2)}]`
}

function DopesheetResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
      onClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      aria-label={label}
      title={label}
    >
      <X className={MINI_ICON_CLASS} />
    </Button>
  )
}
const EMPTY_FRAME_GROUPS: DopesheetPropertyGroupStructure<StructureRow>['frameGroups'] = []

function getMatchingDragState(
  dragState: DragState | null,
  event: PointerEvent,
  disabled: boolean,
): DragState | null {
  if (disabled || !dragState || dragState.pointerId !== event.pointerId) return null
  return dragState
}

function startDopesheetDrag(
  dragState: DragState,
  deltaX: number,
  onDragStart: (() => void) | undefined,
): boolean {
  if (dragState.started) return true
  if (Math.abs(deltaX) <= DRAG_THRESHOLD) return false
  dragState.started = true
  if (!dragState.duplicateOnCommit) onDragStart?.()
  return true
}

function getDopesheetDragDelta(
  dragState: DragState,
  event: PointerEvent,
  effectiveTimelineWidth: number,
  frameRange: number,
  totalFrames: number,
  snapEnabled: boolean,
  snapFrame: (frame: number) => number,
): number {
  const deltaX = event.clientX - dragState.startClientX
  let deltaFrames = Math.round((deltaX / effectiveTimelineWidth) * frameRange)
  if (!snapEnabled || event.ctrlKey || event.metaKey) return deltaFrames
  const anchorInitialFrame = dragState.initialFrames.get(dragState.anchorKeyframeId)
  if (anchorInitialFrame === undefined) return deltaFrames
  const anchorCandidate = clampFrame(anchorInitialFrame + deltaFrames, totalFrames)
  deltaFrames += snapFrame(anchorCandidate) - anchorCandidate
  return deltaFrames
}

const TimelineViewportCuller = memo(function TimelineViewportCuller({
  children,
}: {
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(true)

  useEffect(() => {
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const motionScrollRoot = node.closest('[data-testid="motion-layer-scroll-area"]')
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (!entry.isIntersecting && node.contains(document.activeElement)) return
        setIsNearViewport(entry.isIntersecting)
      },
      {
        root: motionScrollRoot,
        rootMargin: '96px 0px',
      },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="min-w-0 overflow-hidden">
      {isNearViewport ? children : null}
    </div>
  )
})

export const DopesheetEditor = memo(function DopesheetEditor({
  frameViewport,
  onFrameViewportChange,
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  globalFrame = null,
  itemFrom = 0,
  totalFrames = 300,
  fps = 30,
  width = 600,
  height = 260,
  onKeyframeMove,
  onBezierHandleMove,
  onSegmentEasingChange,
  onSelectionChange,
  additionalSnapFrames = [],
  onSelectionFrameDelta,
  onPropertyChange,
  onCurveVisibilityChange,
  onActivePropertyChange,
  onScrub,
  onScrubStart,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onAddKeyframe,
  onDuplicateKeyframes,
  propertyValues = {},
  hiddenPropertyRows = EMPTY_HIDDEN_PROPERTIES,
  compoundPropertyRows = EMPTY_COMPOUND_ROWS,
  compoundSecondaryProperties = EMPTY_COMPOUND_SECONDARIES,
  onPropertyValueCommit,
  onPropertyValuePreview,
  propertyLinks,
  propertyLinkSourceLabels,
  onPropertyLinkPointerDown,
  onRemovePropertyLink,
  linkedTransformExpressions = [],
  linkedTransformSourceLabels = {},
  onLinkedTransformPointerDown,
  onRemoveLinkedTransform,
  propertyExpressions = [],
  preExpressionPropertyValues = {},
  resolveExpressionReference,
  onSetPropertyExpression,
  onRemovePropertyExpression,
  onResetPropertiesToDefault,
  onRemoveKeyframes,
  onCopyKeyframes,
  onCutKeyframes,
  onPasteKeyframes,
  hasKeyframeClipboard = false,
  isKeyframeClipboardCut = false,
  selectedInterpolation,
  interpolationOptions = [],
  onInterpolationChange,
  interpolationDisabled = false,
  onNavigateToKeyframe,
  transitionBlockedRanges = [],
  proceduralPreview,
  canBakeMotion = false,
  onBakeMotion,
  disabled = false,
  visualizationMode = 'dopesheet',
  graphMode = 'value',
  onGraphModeChange,
  speedGraphContent,
  spacious = false,
  inlinePropertyGroupIds = EMPTY_PROPERTY_GROUP_IDS,
  presentation = 'editor',
  propertyColumnWidth,
  singleCurveMode = false,
  selectedCurveVisibleExternally = false,
  propertyFilter,
  proceduralFrameOffset = 0,
  proceduralDurationInFrames = totalFrames,
  initialVisibleGroupIds,
  showPlayhead = true,
  shortcutsEnabled = false,
  shortcuts,
  className,
}: DopesheetEditorProps) {
  const { t } = useTranslation()
  const resolvedPropertyLinks = propertyLinks ?? linkedTransformExpressions
  const resolvedPropertyLinkSourceLabels = propertyLinkSourceLabels ?? linkedTransformSourceLabels
  const beginPropertyLink = onPropertyLinkPointerDown ?? onLinkedTransformPointerDown
  const removePropertyLink = onRemovePropertyLink ?? onRemoveLinkedTransform
  // `split` shows both panes at once. Derive per-pane visibility so the many
  // mode branches below read intent ("is the graph showing?") rather than an
  // exact mode, and the exclusive `dopesheet`/`graph` modes stay unchanged.
  const showSheetPane = visualizationMode !== 'graph'
  const showGraphPane = visualizationMode !== 'dopesheet'
  const isSplitView = visualizationMode === 'split'
  // Wider property column + value inputs when there is room (Animate workspace).
  const columnWidth =
    propertyColumnWidth ?? (spacious ? SPACIOUS_PROPERTY_COLUMN_WIDTH : PROPERTY_COLUMN_WIDTH)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const graphPaneRef = useRef<HTMLDivElement>(null)
  const keyframeButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const committedKeyframeSelectionRef = useRef(selectedKeyframeIds)
  const marqueePreviewSelectionRef = useRef<Set<string> | null>(null)
  const marqueePreviewTouchedIdsRef = useRef(new Set<string>())
  committedKeyframeSelectionRef.current = selectedKeyframeIds
  const snapEnabled = true
  const [valueDrafts, setValueDrafts] = useState<Partial<Record<AnimatableProperty, string>>>({})
  const [editingValueProperty, setEditingValueProperty] = useState<AnimatableProperty | null>(null)
  const [expressionEditor, setExpressionEditor] = useState<{
    property: DirectLinkableProperty
    source: string
    enabled: boolean
    selectionStart: number
    selectionEnd: number
  } | null>(null)
  const expressionTextareaRef = useRef<HTMLTextAreaElement>(null)
  const pickWhipRootRef = useRef<HTMLDivElement>(null)
  const { drag: expressionReferenceDrag, begin: beginExpressionReferenceDrag } =
    useMotionPickWhipDrag<ExpressionReferenceDragOrigin, ExpressionReferenceCandidate>({
      hoverAttribute: 'data-expression-reference-hover',
      getClipRoot: () =>
        pickWhipRootRef.current?.closest<HTMLElement>(
          '[data-pick-whip-scroll-area], [data-testid="motion-layer-scroll-area"]',
        ) ?? pickWhipRootRef.current,
      resolveCandidate: resolveExpressionReferenceCandidate,
      onCommit: (origin, candidate) => {
        const reference = `prop(${JSON.stringify(candidate.itemId)}, ${JSON.stringify(candidate.property)})`
        setExpressionEditor((current) => {
          if (!current || current.property !== origin.property) return current
          const source =
            current.source.slice(0, origin.selectionStart) +
            reference +
            current.source.slice(origin.selectionEnd)
          const cursor = origin.selectionStart + reference.length
          requestAnimationFrame(() => {
            const textarea = expressionTextareaRef.current
            textarea?.focus()
            textarea?.setSelectionRange(cursor, cursor)
          })
          return {
            ...current,
            source,
            selectionStart: cursor,
            selectionEnd: cursor,
          }
        })
      },
    })
  const autoKeyEnabledByProperty = useAutoKeyframeStore(
    useCallback(
      (state) => state.enabledByItem[itemId] ?? EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
      [itemId],
    ),
  )
  const toggleAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.toggleAutoKeyframeEnabled)
  const skipNextBlurCommitPropertyRef = useRef<AnimatableProperty | null>(null)
  const valueDraftAtFocusRef = useRef<Partial<Record<AnimatableProperty, string>>>({})
  const valueScrubRef = useRef<{
    property: AnimatableProperty
    pointerId: number
    startX: number
    startValue: number
    lastValue: number
    lastDisplay: string
    didDrag: boolean
  } | null>(null)
  const appliedDragPreviewFramesRef = useRef<Record<string, number> | null>(null)
  const [sheetPreviewFrames, setSheetPreviewFrames] = useState<Record<string, number> | null>(null)
  const [sheetPreviewDuplicateKeyframeIds, setSheetPreviewDuplicateKeyframeIds] = useState<
    string[] | null
  >(null)

  const keyframeFrameBounds = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const list of Object.values(keyframesByProperty)) {
      for (const keyframe of list ?? []) {
        if (keyframe.frame < min) min = keyframe.frame
        if (keyframe.frame > max) max = keyframe.frame
      }
    }
    return max >= min ? { min, max } : null
  }, [keyframesByProperty])

  const { viewport, updateViewport, normalizeViewport, contentFrameMax, minViewportFrames } =
    useDopesheetViewport({
      itemId,
      totalFrames,
      keyframeFrameBounds,
      frameViewport,
      onFrameViewportChange,
    })

  const { width: timelineWidth } = useElementSize(timelineRef, {
    deps: [visualizationMode],
  })

  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty],
  )
  const hiddenPropertyRowSet = useMemo(
    () => new Set<AnimatableProperty>(hiddenPropertyRows),
    [hiddenPropertyRows],
  )
  // Properties with an actual curve to draw (>= 2 keyframes). The graph picks a
  // default from these so it isn't blank when the selected/first property only
  // has a single keyframe.
  const graphableProperties = useMemo(
    () =>
      availableProperties.filter(
        (property) =>
          !isColorAnimatableProperty(property) && (keyframesByProperty[property]?.length ?? 0) >= 2,
      ),
    [availableProperties, keyframesByProperty],
  )
  const allPropertyGroups = useMemo(
    () => getPropertyAccordionGroups(availableProperties),
    [availableProperties],
  )
  const inlinePropertyGroupIdSet = useMemo(
    () => new Set(inlinePropertyGroupIds),
    [inlinePropertyGroupIds],
  )
  const propertyGroupIdByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, string>()
    for (const group of allPropertyGroups) {
      for (const property of group.properties) {
        map.set(property, group.id)
      }
    }
    return map
  }, [allPropertyGroups])
  const keyframedPropertyIds = useMemo(
    () =>
      new Set(
        availableProperties.filter((property) => (keyframesByProperty[property] ?? []).length > 0),
      ),
    [availableProperties, keyframesByProperty],
  )
  const itemMotionModifiers = useItemsStore((s) => s.itemById[itemId]?.motionModifiers)
  const proceduralBandByProperty = useMemo(
    () =>
      getProceduralBands(itemMotionModifiers, proceduralDurationInFrames, proceduralFrameOffset),
    [itemMotionModifiers, proceduralDurationInFrames, proceduralFrameOffset],
  )
  const {
    graphVisibleProperties,
    setGraphVisibleProperties,
    graphRulerUnit,
    setGraphRulerUnit,
    showAllGraphHandles,
    setShowAllGraphHandles,
    autoZoomGraphHeight,
    setAutoZoomGraphHeight,
    graphVerticalZoomValue,
    setGraphVerticalZoomValue,
    togglePropertyCurve,
    toggleGroupCurves,
  } = useGraphViewState({
    itemId,
    availableProperties,
    graphableProperties,
    selectedProperty,
    onPropertyChange,
    onActivePropertyChange,
  })

  const {
    visibleGroups,
    setVisibleGroups,
    showKeyframedOnly,
    setShowKeyframedOnly,
    toggleVisibleGroup,
    isPropertyLocked,
    toggleLockedProperty,
    setGroupLocked,
  } = usePropertyFilters({
    allPropertyGroups,
    availableProperties,
    initialVisibleGroupIds,
  })
  const filterKeyframedOnly =
    propertyFilter === undefined ? showKeyframedOnly : propertyFilter === 'keyframed'
  const linkedTransformPropertyIds = useMemo(
    () =>
      new Set<string>(
        resolvedPropertyLinks.map((link) => {
          if (link.targetProperty === 'position') return 'x'
          if (link.targetProperty === 'scale') return 'width'
          if (link.targetProperty === 'anchor') return 'anchorX'
          return link.targetProperty
        }),
      ),
    [resolvedPropertyLinks],
  )

  const filteredProperties = useMemo(
    () =>
      availableProperties
        .filter((property) => !hiddenPropertyRowSet.has(property))
        .filter((property) => {
          const groupId = propertyGroupIdByProperty.get(property)
          const groupVisible = groupId ? (visibleGroups[groupId] ?? true) : true
          if (!groupVisible) return false
          if (
            filterKeyframedOnly &&
            !keyframedPropertyIds.has(property) &&
            !linkedTransformPropertyIds.has(property) &&
            !(propertyFilter === 'keyframed' && proceduralBandByProperty.has(property))
          )
            return false
          return true
        }),
    [
      availableProperties,
      hiddenPropertyRowSet,
      keyframedPropertyIds,
      linkedTransformPropertyIds,
      proceduralBandByProperty,
      propertyGroupIdByProperty,
      propertyFilter,
      filterKeyframedOnly,
      visibleGroups,
    ],
  )
  const activeSelectedProperty =
    selectedProperty && filteredProperties.includes(selectedProperty) ? selectedProperty : null
  const visibleProperties = filteredProperties
  const propertyColumnProperties = filteredProperties
  const hasPropertyFilters =
    filterKeyframedOnly || allPropertyGroups.some((group) => visibleGroups[group.id] === false)

  // Frame-independent keyframe data. These references only change when the
  // properties or keyframes change — NOT when the playhead moves — so the
  // memoized timeline grid cells can skip re-rendering during scrubs.
  const sheetKeyframesByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, Keyframe[]>()
    for (const property of visibleProperties) {
      map.set(
        property,
        (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
      )
    }
    return map
  }, [visibleProperties, keyframesByProperty])

  const sheetRowsStructure = useMemo(
    () =>
      visibleProperties.map((property) => ({
        property,
        keyframes: sheetKeyframesByProperty.get(property) ?? [],
      })),
    [visibleProperties, sheetKeyframesByProperty],
  )

  // Stable, frame-independent group structure keyed by group id — used to feed
  // the memoized group timeline cells.
  const groupTimelineById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildGroupedPropertyStructure>[number]>()
    for (const group of buildGroupedPropertyStructure(sheetRowsStructure)) {
      map.set(group.id, group)
    }
    return map
  }, [sheetRowsStructure])

  // Playhead-dependent rows (carry the per-frame `controls`). `propertyColumnProperties`
  // is the same list as `visibleProperties`, so the column/sheet rows are identical.
  const sheetRows = useMemo<DopesheetPropertyRow[]>(
    () =>
      sheetRowsStructure.map((row) => ({
        ...row,
        controls: getDopesheetRowControlState(row.keyframes, currentFrame),
      })),
    [sheetRowsStructure, currentFrame],
  )

  const propertyRows = sheetRows
  const groupedSheetRows = useMemo(
    () => buildGroupedPropertyRows(sheetRows, currentFrame),
    [currentFrame, sheetRows],
  )
  const groupedPropertyRows = groupedSheetRows
  const propertyRowByProperty = useMemo(
    () => new Map(propertyRows.map((row) => [row.property, row])),
    [propertyRows],
  )
  const { expandedGroups, toggleGroup, setAllGroupsExpanded } = useGroupExpansion({
    allPropertyGroups,
    groupedSheetRows,
    groupedPropertyRows,
    activeSelectedProperty,
  })

  const resetParameterView = useCallback(() => {
    setShowKeyframedOnly(false)
    setVisibleGroups(
      Object.fromEntries(allPropertyGroups.map((group) => [group.id, true])) as Record<
        string,
        boolean
      >,
    )
    setAllGroupsExpanded(true)
  }, [allPropertyGroups, setAllGroupsExpanded, setShowKeyframedOnly, setVisibleGroups])

  const graphPaneSize = useElementSize(graphPaneRef, {
    enabled: showGraphPane,
    deps: [visualizationMode, propertyRows.length],
  })

  const formatPropertyValue = useCallback(
    (property: AnimatableProperty, value: number | undefined) => {
      if (value === undefined || Number.isNaN(value)) return ''
      if (isColorAnimatableProperty(property)) return keyframeValueToHexColor(value)
      const decimals = PROPERTY_VALUE_RANGES[property]?.decimals ?? 2
      return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals)
    },
    [],
  )

  useEffect(() => {
    setValueDrafts((prev) => {
      let changed = false
      const nextDrafts = { ...prev }

      for (const property of propertyColumnProperties) {
        if (editingValueProperty === property) continue
        const nextValue = formatPropertyValue(property, propertyValues[property])
        if (nextDrafts[property] !== nextValue) {
          nextDrafts[property] = nextValue
          changed = true
        }
      }

      return changed ? nextDrafts : prev
    })
  }, [propertyColumnProperties, propertyValues, editingValueProperty, formatPropertyValue])
  const rowKeyframesByProperty = sheetKeyframesByProperty

  const keyframeMetaById = useMemo(() => {
    const map = new Map<string, KeyframeMeta>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        map.set(keyframe.id, { property: row.property, keyframe })
      }
    }
    return map
  }, [sheetRowsStructure])

  const keyframeMetaByIdRef = useRef(keyframeMetaById)
  keyframeMetaByIdRef.current = keyframeMetaById

  const selectedFrameSummary = useMemo(() => {
    const selectedFrames: number[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (meta) {
        selectedFrames.push(meta.keyframe.frame)
      }
    }

    if (selectedFrames.length === 0) {
      return {
        hasSelection: false,
        hasMixedFrames: false,
        localFrame: null as number | null,
        globalFrame: null as number | null,
      }
    }

    const firstFrame = selectedFrames[0] ?? null
    const hasMixedFrames = selectedFrames.some((frame) => frame !== firstFrame)
    const frameOffset = globalFrame === null ? null : globalFrame - currentFrame

    return {
      hasSelection: true,
      hasMixedFrames,
      localFrame: hasMixedFrames ? null : firstFrame,
      globalFrame:
        hasMixedFrames || firstFrame === null || frameOffset === null
          ? null
          : firstFrame + frameOffset,
    }
  }, [currentFrame, globalFrame, keyframeMetaById, selectedKeyframeIds])
  const selectedCurveProperty = useMemo(() => {
    let property: AnimatableProperty | null = null

    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) {
        continue
      }

      if (property === null) {
        property = meta.property
        continue
      }

      if (property !== meta.property) {
        return null
      }
    }

    return property
  }, [keyframeMetaById, selectedKeyframeIds])

  useEffect(() => {
    if (!showGraphPane || !selectedCurveProperty) {
      return
    }

    if (selectedProperty !== selectedCurveProperty) {
      onPropertyChange?.(selectedCurveProperty)
    }
    onActivePropertyChange?.(selectedCurveProperty)
  }, [
    onActivePropertyChange,
    onPropertyChange,
    selectedCurveProperty,
    selectedProperty,
    showGraphPane,
  ])

  const visibleKeyframes = useMemo(
    () =>
      sheetRows.flatMap((row) =>
        row.keyframes.map((keyframe) => ({
          property: row.property,
          keyframe,
        })),
      ),
    [sheetRows],
  )

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const horizontalZoomRatioBase = useMemo(
    () => Math.max(1, contentFrameMax / Math.max(1, minViewportFrames)),
    [contentFrameMax, minViewportFrames],
  )
  const horizontalZoomValue = useMemo(() => {
    if (horizontalZoomRatioBase <= 1) {
      return 0
    }

    const normalized =
      Math.log(contentFrameMax / Math.max(1, frameRange)) / Math.log(horizontalZoomRatioBase)
    return Math.max(0, Math.min(100, normalized * 100))
  }, [contentFrameMax, frameRange, horizontalZoomRatioBase])
  const visibleGraphProperties = useMemo(() => {
    const properties = new Set(graphVisibleProperties)
    for (const property of graphVisibleProperties) {
      const secondary = compoundSecondaryProperties[property]
      if (secondary) properties.add(secondary)
    }
    return [...properties]
  }, [compoundSecondaryProperties, graphVisibleProperties])
  const graphBaseValueRange = useMemo(
    () =>
      getCombinedGraphValueRange(
        visibleGraphProperties.map((property) => PROPERTY_VALUE_RANGES[property] ?? null),
        visibleGraphProperties.map((property) => keyframesByProperty[property] ?? []),
        autoZoomGraphHeight,
      ),
    [autoZoomGraphHeight, keyframesByProperty, visibleGraphProperties],
  )
  const graphBaseValueSpan = useMemo(
    () => Math.max(0.0001, graphBaseValueRange.max - graphBaseValueRange.min),
    [graphBaseValueRange],
  )
  const graphMinZoomValueSpan = useMemo(
    () => Math.max(graphBaseValueSpan * 0.02, 0.0001),
    [graphBaseValueSpan],
  )
  const verticalZoomRatioBase = useMemo(
    () => Math.max(1, graphBaseValueSpan / graphMinZoomValueSpan),
    [graphBaseValueSpan, graphMinZoomValueSpan],
  )
  const fallbackTimelineWidth = Math.max(width - columnWidth, 1)
  const effectiveTimelineWidth = Math.max(timelineWidth || fallbackTimelineWidth, 1)
  const timelinePixelsPerSecond = useMemo(
    () => (effectiveTimelineWidth / frameRange) * fps,
    [effectiveTimelineWidth, frameRange, fps],
  )

  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth],
  )
  const getRenderedKeyframeX = useCallback(
    (frame: number) => getVisibleKeyframeX(frame, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth],
  )
  const setKeyframeButtonRef = useCallback((keyframeId: string, node: HTMLButtonElement | null) => {
    if (node) {
      keyframeButtonRefs.current.set(keyframeId, node)
      const previewSelection = marqueePreviewSelectionRef.current
      if (previewSelection) {
        const previewSelected = previewSelection.has(keyframeId)
        if (previewSelected !== committedKeyframeSelectionRef.current.has(keyframeId)) {
          node.dataset.marqueeSelected = String(previewSelected)
          marqueePreviewTouchedIdsRef.current.add(keyframeId)
        }
      }
    } else {
      keyframeButtonRefs.current.delete(keyframeId)
    }
  }, [])
  const handleMarqueeSelectionPreviewChange = useCallback(
    (nextSelection: Set<string> | null) => {
      const touchedIds = new Set(marqueePreviewTouchedIdsRef.current)
      for (const keyframeId of committedKeyframeSelectionRef.current) touchedIds.add(keyframeId)
      if (nextSelection) {
        for (const keyframeId of nextSelection) touchedIds.add(keyframeId)
      }

      const nextTouchedIds = new Set<string>()
      for (const keyframeId of touchedIds) {
        const button = keyframeButtonRefs.current.get(keyframeId)
        if (!button) continue
        if (!nextSelection) {
          delete button.dataset.marqueeSelected
          continue
        }

        const previewSelected = nextSelection.has(keyframeId)
        const committedSelected = committedKeyframeSelectionRef.current.has(keyframeId)
        if (previewSelected === committedSelected) {
          delete button.dataset.marqueeSelected
        } else {
          button.dataset.marqueeSelected = String(previewSelected)
          nextTouchedIds.add(keyframeId)
        }
      }

      marqueePreviewSelectionRef.current = nextSelection
      marqueePreviewTouchedIdsRef.current = nextTouchedIds
    },
    [],
  )
  const applyDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      const previousPreviewFrames = appliedDragPreviewFramesRef.current
      if (arePreviewFramesEqual(previousPreviewFrames, nextPreviewFrames)) {
        return
      }

      const duplicatePreviewIds =
        dragStateRef.current?.duplicateOnCommit && nextPreviewFrames
          ? dragStateRef.current.selectedKeyframeIds
          : null

      flushSync(() => {
        setSheetPreviewFrames(nextPreviewFrames)
        setSheetPreviewDuplicateKeyframeIds(duplicatePreviewIds)
      })

      const keyframeIds = new Set([
        ...Object.keys(previousPreviewFrames ?? {}),
        ...Object.keys(nextPreviewFrames ?? {}),
      ])

      if (duplicatePreviewIds) {
        appliedDragPreviewFramesRef.current = nextPreviewFrames
        return
      }

      for (const keyframeId of keyframeIds) {
        const button = keyframeButtonRefs.current.get(keyframeId)
        if (!button) continue

        const previewFrame = nextPreviewFrames?.[keyframeId]
        const frame = previewFrame ?? keyframeMetaByIdRef.current.get(keyframeId)?.keyframe.frame
        if (frame === undefined) continue

        const renderedX = getRenderedKeyframeX(frame)
        if (renderedX === null) {
          button.style.visibility = 'hidden'
          continue
        }

        button.style.left = `${renderedX}px`
        button.style.visibility = 'visible'
      }

      appliedDragPreviewFramesRef.current = nextPreviewFrames
    },
    [getRenderedKeyframeX],
  )
  const scheduleDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      applyDragPreviewFrames(nextPreviewFrames)
    },
    [applyDragPreviewFrames],
  )
  const renderedKeyframeXById = useMemo(() => {
    const positions = new Map<string, number>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        const x = getRenderedKeyframeX(keyframe.frame)
        if (x !== null) {
          positions.set(keyframe.id, x)
        }
      }
    }
    return positions
  }, [sheetRowsStructure, getRenderedKeyframeX])
  const renderedSheetEntries = useMemo(() => {
    const entries: RenderedSheetEntry[] = []
    let top = 0

    for (const group of groupedSheetRows) {
      const inline = inlinePropertyGroupIdSet.has(group.id)
      if (!inline) {
        entries.push({ type: 'group', group, top })
        top += GROUP_HEADER_HEIGHT
      }

      if (!inline && !(expandedGroups[group.id] ?? true)) {
        continue
      }

      for (const row of group.rows) {
        entries.push({ type: 'row', row, top, indented: !inline })
        top += ROW_HEIGHT
      }
    }

    return {
      entries,
      contentHeight: top,
    }
  }, [expandedGroups, groupedSheetRows, inlinePropertyGroupIdSet])
  // Marquee points are only needed while a selection marquee is moving.
  // Building them eagerly duplicated the viewport-sensitive keyframe position
  // pass on every zoom frame, even when no marquee interaction was active.
  const getKeyframePoints = useCallback(
    () =>
      renderedSheetEntries.entries.flatMap((entry) => {
        if (entry.type === 'group') {
          return entry.group.frameGroups.flatMap((frameGroup) => {
            const x = getRenderedKeyframeX(frameGroup.frame)
            if (x === null) return []

            return frameGroup.keyframes
              .filter(({ property }) => !isPropertyLocked(property))
              .map(({ keyframe }) => ({
                keyframeId: keyframe.id,
                x,
                y: entry.top + GROUP_HEADER_HEIGHT / 2,
              }))
          })
        }

        if (isPropertyLocked(entry.row.property)) {
          return []
        }

        return entry.row.keyframes.flatMap((keyframe) => {
          const x = renderedKeyframeXById.get(keyframe.id)
          if (x === undefined) return []
          return [
            {
              keyframeId: keyframe.id,
              x,
              y: entry.top + ROW_HEIGHT / 2,
            },
          ]
        })
      }),
    [getRenderedKeyframeX, isPropertyLocked, renderedKeyframeXById, renderedSheetEntries.entries],
  )

  const xToFrame = useCallback(
    (x: number) => getFrameFromAxisX(x, viewport, effectiveTimelineWidth),
    [viewport, effectiveTimelineWidth],
  )

  const getFrameFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return currentFrame
      const rect = node.getBoundingClientRect()
      return clampFrame(xToFrame(clientX - rect.left), totalFrames)
    },
    [xToFrame, totalFrames, currentFrame],
  )

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return Math.max(0, Math.min(effectiveTimelineWidth, clientX - rect.left))
    },
    [effectiveTimelineWidth],
  )

  const getContentYFromClientY = useCallback(
    (clientY: number) => {
      const node = scrollAreaRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      const y = clientY - rect.top + node.scrollTop
      const maxY = Math.max(0, renderedSheetEntries.contentHeight)
      return Math.max(0, Math.min(maxY, y))
    },
    [renderedSheetEntries.contentHeight],
  )

  const ticks = useMemo(() => {
    const step = getNiceTickStep(frameRange)
    const first = Math.floor(viewport.startFrame / step) * step
    const result: number[] = []
    for (let frame = first; frame <= viewport.endFrame; frame += step) {
      if (frame >= viewport.startFrame) {
        result.push(frame)
      }
    }
    return result
  }, [viewport.startFrame, viewport.endFrame, frameRange])

  const propertyGridStyle = useMemo(() => {
    return { gridTemplateColumns: `${columnWidth}px 1fr` }
  }, [columnWidth])

  const selectedRefs = useMemo(() => {
    const refs: KeyframeRef[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) continue
      if (isPropertyLocked(meta.property)) continue
      refs.push({
        itemId,
        property: meta.property,
        keyframeId,
      })
    }
    return refs
  }, [selectedKeyframeIds, keyframeMetaById, isPropertyLocked, itemId])
  const selectedRefIds = useMemo(() => selectedRefs.map((ref) => ref.keyframeId), [selectedRefs])

  const isCurrentFrameBlocked = useMemo(
    () =>
      transitionBlockedRanges.some(
        (range) => currentFrame >= range.start && currentFrame < range.end,
      ),
    [transitionBlockedRanges, currentFrame],
  )

  // Adds inside a transition region are rejected by the action layer; surface
  // that instead of failing silently. A fixed toast id prevents stacking on
  // repeated clicks.
  const notifyKeyframeBlocked = useCallback(() => {
    toast.warning(t('timeline.keyframeEditor.transitionBlocked'), {
      id: 'keyframe-transition-blocked',
    })
  }, [t])

  const snapFrameTargets = useMemo(() => {
    const targets: number[] = [0, currentFrame, ...additionalSnapFrames]
    for (const { keyframe } of visibleKeyframes) {
      if (!selectedKeyframeIds.has(keyframe.id)) {
        targets.push(keyframe.frame)
      }
    }
    return [...new Set(targets)]
  }, [additionalSnapFrames, visibleKeyframes, selectedKeyframeIds, currentFrame])

  const snapThresholdFrames = useMemo(
    () => (SNAP_THRESHOLD_PX / effectiveTimelineWidth) * frameRange,
    [effectiveTimelineWidth, frameRange],
  )

  const snapFrame = useCallback(
    (frame: number) => {
      let closest = frame
      let minDistance = Infinity
      for (const target of snapFrameTargets) {
        const distance = Math.abs(frame - target)
        if (distance <= snapThresholdFrames && distance < minDistance) {
          minDistance = distance
          closest = target
        }
      }
      return closest
    },
    [snapFrameTargets, snapThresholdFrames],
  )

  const zoomAroundFrame = useCallback(
    (centerFrame: number, factor: number) => {
      updateViewport((prev) => {
        const prevRange = Math.max(1, prev.endFrame - prev.startFrame)
        const nextRange = Math.max(
          minViewportFrames,
          Math.min(contentFrameMax, Math.round(prevRange * factor)),
        )
        const ratio = (centerFrame - prev.startFrame) / prevRange
        let nextStart = Math.round(centerFrame - ratio * nextRange)
        let nextEnd = nextStart + nextRange

        if (nextStart < 0) {
          nextEnd -= nextStart
          nextStart = 0
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax
          nextStart = Math.max(0, nextStart - overflow)
          nextEnd = contentFrameMax
        }
        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd })
      })
    },
    [contentFrameMax, minViewportFrames, normalizeViewport, updateViewport],
  )
  const setHorizontalZoomValue = useCallback(
    (nextValue: number) => {
      if (horizontalZoomRatioBase <= 1) {
        return
      }

      const normalized = Math.max(0, Math.min(1, nextValue / 100))
      const nextRange = Math.max(
        minViewportFrames,
        Math.min(
          contentFrameMax,
          Math.round(contentFrameMax / Math.pow(horizontalZoomRatioBase, normalized)),
        ),
      )

      updateViewport((prev) => {
        const centerFrame = (prev.startFrame + prev.endFrame) / 2
        let nextStart = Math.round(centerFrame - nextRange / 2)
        let nextEnd = nextStart + nextRange

        if (nextStart < 0) {
          nextEnd -= nextStart
          nextStart = 0
        }
        if (nextEnd > contentFrameMax) {
          const overflow = nextEnd - contentFrameMax
          nextStart = Math.max(0, nextStart - overflow)
          nextEnd = contentFrameMax
        }

        return normalizeViewport({ startFrame: nextStart, endFrame: nextEnd })
      })
    },
    [
      contentFrameMax,
      horizontalZoomRatioBase,
      minViewportFrames,
      normalizeViewport,
      updateViewport,
    ],
  )

  const panFrames = useCallback(
    (deltaFrames: number) => {
      if (deltaFrames === 0) return
      updateViewport((prev) => {
        const range = Math.max(1, prev.endFrame - prev.startFrame)
        const maxStart = Math.max(0, contentFrameMax - range)
        const nextStart = Math.max(0, Math.min(maxStart, prev.startFrame + deltaFrames))
        return normalizeViewport({
          startFrame: nextStart,
          endFrame: nextStart + range,
        })
      })
    },
    [contentFrameMax, normalizeViewport, updateViewport],
  )

  const resetViewport = useCallback(() => {
    updateViewport({ startFrame: 0, endFrame: contentFrameMax })
  }, [contentFrameMax, updateViewport])

  const fitKeyframesInView = useCallback(() => {
    const selectedFrames = Array.from(selectedKeyframeIds, (keyframeId) =>
      keyframeMetaById.get(keyframeId),
    )
      .filter((meta): meta is KeyframeMeta => Boolean(meta))
      .map((meta) => meta.keyframe.frame)

    if (selectedFrames.length === 0) {
      resetViewport()
      return
    }

    const minFrame = Math.min(...selectedFrames)
    const maxFrame = Math.max(...selectedFrames)
    const selectionRange = Math.max(1, maxFrame - minFrame)
    const paddedRange = Math.max(
      minViewportFrames,
      selectionRange + Math.max(4, selectionRange * 0.2),
    )
    const centerFrame = (minFrame + maxFrame) / 2
    updateViewport(
      normalizeViewport({
        startFrame: Math.round(centerFrame - paddedRange / 2),
        endFrame: Math.round(centerFrame + paddedRange / 2),
      }),
    )
  }, [
    keyframeMetaById,
    minViewportFrames,
    normalizeViewport,
    resetViewport,
    selectedKeyframeIds,
    updateViewport,
  ])

  const handleRemoveKeyframes = useCallback(() => {
    if (!onRemoveKeyframes || selectedRefs.length === 0) return
    onRemoveKeyframes(selectedRefs)
  }, [onRemoveKeyframes, selectedRefs])

  const buildSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, requestedDeltaFrames: number) => {
      return buildSelectionFramePreviewState({
        selectionIds,
        requestedDeltaFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        keyframesByProperty,
        totalFrames,
        transitionBlockedRanges,
      })
    },
    [isPropertyLocked, keyframesByProperty, totalFrames, transitionBlockedRanges],
  )

  const commitSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return commitSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onKeyframeMove,
      })
    },
    [isPropertyLocked, itemId, onKeyframeMove],
  )
  const duplicateSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return duplicateSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onDuplicateKeyframes,
      })
    },
    [isPropertyLocked, itemId, onDuplicateKeyframes],
  )

  const canClearRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onRemoveKeyframes) return false
      if (isPropertyLocked(row.property)) return false
      return row.keyframes.length > 0
    },
    [disabled, isPropertyLocked, onRemoveKeyframes],
  )

  const moveSelectedKeyframesByDelta = useCallback(
    (deltaFrames: number) => {
      if (disabled || !onKeyframeMove || selectedRefIds.length === 0 || deltaFrames === 0) {
        return { didMove: false, appliedDeltaFrames: 0 }
      }

      const preview = buildSelectionFramePreview(selectedRefIds, deltaFrames)
      if (!preview.previewFrames) {
        return { didMove: false, appliedDeltaFrames: 0 }
      }

      onDragStart?.()
      const didMove = commitSelectionFramePreview(
        preview.movableSelectionIds,
        preview.previewFrames,
      )
      onDragEnd?.()

      return {
        didMove,
        appliedDeltaFrames: preview.appliedDeltaFrames,
      }
    },
    [
      buildSelectionFramePreview,
      commitSelectionFramePreview,
      disabled,
      onDragEnd,
      onDragStart,
      onKeyframeMove,
      selectedRefIds,
    ],
  )

  const {
    localFrameInputValue,
    globalFrameInputValue,
    setLocalFrameInputValue,
    setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef,
    commitLocalFrameInput,
    commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  } = useHeaderFrameInputs({
    selectedFrameSummary,
    currentFrame,
    globalFrame,
    totalFrames,
    transitionBlockedRanges,
    onKeyframeMove,
    onNavigateToKeyframe,
    moveSelectedKeyframesByDelta,
  })

  const activateProperty = useCallback(
    (property: AnimatableProperty) => {
      if (showGraphPane) {
        if (singleCurveMode) {
          setGraphVisibleProperties(new Set([property]))
          onCurveVisibilityChange?.(property, true)
        }
        onPropertyChange?.(property)
      }
      onActivePropertyChange?.(property)
    },
    [
      onActivePropertyChange,
      onCurveVisibilityChange,
      onPropertyChange,
      setGraphVisibleProperties,
      showGraphPane,
      singleCurveMode,
    ],
  )

  const showSinglePropertyCurve = useCallback(
    (property: AnimatableProperty) => {
      setGraphVisibleProperties(new Set([property]))
      onPropertyChange?.(property)
      onActivePropertyChange?.(property)
      onCurveVisibilityChange?.(property, true)
    },
    [onActivePropertyChange, onCurveVisibilityChange, onPropertyChange, setGraphVisibleProperties],
  )

  const removeKeyframesForRows = useCallback(
    (rows: DopesheetPropertyRow[]) => {
      if (!onRemoveKeyframes) return

      const refs = buildRowKeyframeRefs(itemId, rows)

      if (refs.length === 0) return

      onRemoveKeyframes(refs)

      if (onSelectionChange) {
        onSelectionChange(
          removeSelectionIds(
            selectedKeyframeIds,
            refs.map((ref) => ref.keyframeId),
          ),
          { preserveExternalSelection: true },
        )
      }
    },
    [itemId, onRemoveKeyframes, onSelectionChange, selectedKeyframeIds],
  )

  const handleClearProperty = useCallback(
    (property: AnimatableProperty) => {
      const row = propertyRowByProperty.get(property)
      if (!row || !canClearRow(row)) return

      activateProperty(property)
      removeKeyframesForRows([row])
    },
    [activateProperty, canClearRow, propertyRowByProperty, removeKeyframesForRows],
  )

  const handleClearGroup = useCallback(
    (group: DopesheetPropertyGroup) => {
      removeKeyframesForRows(group.rows.filter((row) => canClearRow(row)))
    },
    [canClearRow, removeKeyframesForRows],
  )

  const handleRowNavigate = useCallback(
    (property: AnimatableProperty, keyframe: Keyframe | null) => {
      if (!keyframe || !onNavigateToKeyframe) return
      activateProperty(property)
      onNavigateToKeyframe(keyframe.frame)
      onSelectionChange?.(new Set([keyframe.id]))
      selectionAnchorByPropertyRef.current.set(property, keyframe.id)
    },
    [activateProperty, onNavigateToKeyframe, onSelectionChange],
  )

  const handleRowToggleKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return
        const refs = buildPropertyKeyframeRefs(itemId, property, currentKeyframes)
        onRemoveKeyframes(refs)
        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(
              selectedKeyframeIds,
              currentKeyframes.map((keyframe) => keyframe.id),
            ),
            { preserveExternalSelection: true },
          )
        }
        return
      }

      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      if (!onAddKeyframe) return
      onAddKeyframe(property, currentFrame)
    },
    [
      currentFrame,
      isCurrentFrameBlocked,
      notifyKeyframeBlocked,
      itemId,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
      activateProperty,
      isPropertyLocked,
    ],
  )

  const handleRowValueChange = useCallback((property: AnimatableProperty, value: string) => {
    setValueDrafts((prev) => ({ ...prev, [property]: value }))
  }, [])

  const handleRowAutoKeyToggle = useCallback(
    (property: AnimatableProperty) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      toggleAutoKeyframeEnabled(itemId, property)
    },
    [activateProperty, isPropertyLocked, itemId, toggleAutoKeyframeEnabled],
  )

  const handleRowValueCommit = useCallback(
    (property: AnimatableProperty, options?: { allowCreate?: boolean }) => {
      if (isPropertyLocked(property)) return
      const range = PROPERTY_VALUE_RANGES[property]
      const parsed = isColorAnimatableProperty(property)
        ? colorStringToKeyframeValue(valueDrafts[property] ?? '')
        : Number(valueDrafts[property])

      if (parsed === null || !Number.isFinite(parsed)) {
        setValueDrafts((prev) => ({
          ...prev,
          [property]: formatPropertyValue(property, propertyValues[property]),
        }))
        return
      }

      const clampedValue = Math.max(range?.min ?? parsed, Math.min(range?.max ?? parsed, parsed))
      onPropertyValueCommit?.(property, clampedValue, options)
      setValueDrafts((prev) => ({
        ...prev,
        [property]: formatPropertyValue(property, clampedValue),
      }))
    },
    [formatPropertyValue, isPropertyLocked, onPropertyValueCommit, propertyValues, valueDrafts],
  )

  const handleValueScrubStart = useCallback(
    (event: React.PointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      if (event.button !== 0 || isColorAnimatableProperty(property)) return
      const startValue = Number(valueDrafts[property] ?? propertyValues[property])
      if (!Number.isFinite(startValue)) return

      valueScrubRef.current = {
        property,
        pointerId: event.pointerId,
        startX: event.clientX,
        startValue,
        lastValue: startValue,
        lastDisplay: String(startValue),
        didDrag: false,
      }
      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [propertyValues, valueDrafts],
  )

  const handleValueScrubMove = useCallback(
    (event: React.PointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      const scrub = valueScrubRef.current
      if (!scrub || scrub.pointerId !== event.pointerId || scrub.property !== property) return
      const deltaX = event.clientX - scrub.startX
      if (!scrub.didDrag && Math.abs(deltaX) < DRAG_THRESHOLD) return

      if (!scrub.didDrag) {
        scrub.didDrag = true
        activateProperty(property)
        onDragStart?.()
      }

      event.preventDefault()
      const range = PROPERTY_VALUE_RANGES[property]
      const next = getScrubbedPropertyValue({
        startValue: scrub.startValue,
        deltaX,
        decimals: range?.decimals ?? 2,
        min: range?.min,
        max: range?.max,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      })
      scrub.lastValue = next.value
      scrub.lastDisplay = next.display
      setValueDrafts((previous) => ({ ...previous, [property]: next.display }))
      onPropertyValuePreview?.(property, next.value)
    },
    [activateProperty, onDragStart, onPropertyValuePreview],
  )

  const handleValueScrubEnd = useCallback(
    (event: React.PointerEvent<HTMLInputElement>, property: AnimatableProperty) => {
      const scrub = valueScrubRef.current
      if (!scrub || scrub.pointerId !== event.pointerId || scrub.property !== property) return
      valueScrubRef.current = null
      if (!scrub.didDrag) return

      event.preventDefault()
      valueDraftAtFocusRef.current[property] = scrub.lastDisplay
      if (onPropertyValuePreview) {
        onDragEnd?.()
      } else {
        onPropertyValueCommit?.(property, scrub.lastValue, { allowCreate: true })
      }
    },
    [onDragEnd, onPropertyValueCommit, onPropertyValuePreview],
  )

  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      moveSelectedKeyframesByDelta(deltaFrames)
    },
    [moveSelectedKeyframesByDelta],
  )

  const activePropertyRow = selectedProperty
    ? propertyRowByProperty.get(selectedProperty)
    : undefined

  useHotkeys(
    shortcuts?.toggleKeyframe ?? '',
    (event) => {
      event.preventDefault()
      if (activePropertyRow) {
        handleRowToggleKeyframe(
          activePropertyRow.property,
          activePropertyRow.controls.currentKeyframes,
        )
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enabled:
        shortcutsEnabled && !disabled && Boolean(shortcuts?.toggleKeyframe && activePropertyRow),
    },
    [activePropertyRow, disabled, handleRowToggleKeyframe, shortcutsEnabled],
  )

  useHotkeys(
    shortcuts?.previousKeyframe ?? '',
    (event) => {
      event.preventDefault()
      if (activePropertyRow) {
        handleRowNavigate(activePropertyRow.property, activePropertyRow.controls.prevKeyframe)
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enabled:
        shortcutsEnabled && !disabled && Boolean(shortcuts?.previousKeyframe && activePropertyRow),
    },
    [activePropertyRow, disabled, handleRowNavigate, shortcutsEnabled],
  )

  useHotkeys(
    shortcuts?.nextKeyframe ?? '',
    (event) => {
      event.preventDefault()
      if (activePropertyRow) {
        handleRowNavigate(activePropertyRow.property, activePropertyRow.controls.nextKeyframe)
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enabled:
        shortcutsEnabled && !disabled && Boolean(shortcuts?.nextKeyframe && activePropertyRow),
    },
    [activePropertyRow, disabled, handleRowNavigate, shortcutsEnabled],
  )

  useHotkeys(
    shortcuts?.toggleAutoKey ?? '',
    (event) => {
      event.preventDefault()
      if (activePropertyRow) {
        handleRowAutoKeyToggle(activePropertyRow.property)
      }
    },
    {
      ...HOTKEY_OPTIONS,
      enabled:
        shortcutsEnabled &&
        !disabled &&
        Boolean(shortcuts?.toggleAutoKey && activePropertyRow && onPropertyValueCommit),
    },
    [activePropertyRow, disabled, handleRowAutoKeyToggle, onPropertyValueCommit, shortcutsEnabled],
  )

  useHotkeys(
    shortcuts?.fitKeyframes ?? '',
    (event) => {
      event.preventDefault()
      fitKeyframesInView()
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: shortcutsEnabled && !disabled && Boolean(shortcuts?.fitKeyframes),
    },
    [disabled, fitKeyframesInView, shortcutsEnabled],
  )

  useHotkeys(
    'delete,backspace',
    (event) => {
      event.preventDefault()
      if (selectedRefs.length > 0) {
        onRemoveKeyframes?.(selectedRefs)
      }
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs, onRemoveKeyframes],
  )

  useHotkeys(
    'left',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(-1)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'right',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(1)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+left',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(-10)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+right',
    (event) => {
      event.preventDefault()
      nudgeSelectedKeyframes(10)
    },
    { ...HOTKEY_OPTIONS, enabled: !disabled && selectedRefs.length > 0 },
    [disabled, selectedRefs.length, nudgeSelectedKeyframes],
  )

  const dragStateRef = useRef<DragState | null>(null)
  const selectionAnchorByPropertyRef = useRef(new Map<AnimatableProperty, string>())

  const {
    marqueeOverlayRef,
    getMarqueeModeFromPointerEvent,
    beginMarqueeSelection,
  } = useDopesheetMarquee({
    getKeyframePoints,
    scrollAreaRef,
    getTimelineXFromClientX,
    getContentYFromClientY,
    onSelectionChange,
    onSelectionPreviewChange: handleMarqueeSelectionPreviewChange,
  })

  const handleKeyframePointerDown = useCallback(
    (
      property: AnimatableProperty,
      keyframeId: string,
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const propertyKeyframes = rowKeyframesByProperty.get(property) ?? []
        const clickedIndex = propertyKeyframes.findIndex((keyframe) => keyframe.id === keyframeId)
        const anchorId = selectionAnchorByPropertyRef.current.get(property)
        const anchorIndex = anchorId
          ? propertyKeyframes.findIndex((keyframe) => keyframe.id === anchorId)
          : -1

        const nextSelection = new Set(selectedKeyframeIds)
        if (clickedIndex >= 0 && anchorIndex >= 0) {
          const start = Math.min(clickedIndex, anchorIndex)
          const end = Math.max(clickedIndex, anchorIndex)
          for (let i = start; i <= end; i++) {
            const keyframe = propertyKeyframes[i]
            if (keyframe) nextSelection.add(keyframe.id)
          }
        } else {
          nextSelection.add(keyframeId)
        }
        onSelectionChange?.(nextSelection, { preserveExternalSelection: true })
        selectionAnchorByPropertyRef.current.set(property, keyframeId)
        return
      }

      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(selectedKeyframeIds)
        if (nextSelection.has(keyframeId)) {
          nextSelection.delete(keyframeId)
        } else {
          nextSelection.add(keyframeId)
        }
        onSelectionChange?.(nextSelection, { preserveExternalSelection: true })
        selectionAnchorByPropertyRef.current.set(property, keyframeId)
        return
      }

      const baseSelection = selectedKeyframeIds.has(keyframeId)
        ? new Set(selectedKeyframeIds)
        : new Set([keyframeId])

      if (!selectedKeyframeIds.has(keyframeId)) {
        onSelectionChange?.(baseSelection)
      }
      selectionAnchorByPropertyRef.current.set(property, keyframeId)

      const selectedIdsForDrag =
        baseSelection.has(keyframeId) && baseSelection.size > 1
          ? Array.from(baseSelection)
          : [keyframeId]

      const initialFrames = new Map<string, number>()
      for (const id of selectedIdsForDrag) {
        const meta = keyframeMetaByIdRef.current.get(id)
        if (!meta) continue
        initialFrames.set(id, meta.keyframe.frame)
      }

      dragStateRef.current = {
        anchorKeyframeId: keyframeId,
        selectedKeyframeIds: selectedIdsForDrag,
        initialFrames,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
        appliedDeltaFrames: 0,
      }
      scheduleDragPreviewFrames(null)

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      rowKeyframesByProperty,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
      onSelectionChange,
    ],
  )
  const handleGroupKeyframePointerDown = useCallback(
    (
      frameGroup: DopesheetPropertyGroup['frameGroups'][number],
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return
      if (event.button !== 0) return

      const movableEntries = frameGroup.keyframes.filter(
        ({ property }) => !isPropertyLocked(property),
      )
      if (movableEntries.length === 0) return

      event.preventDefault()
      event.stopPropagation()

      const keyframeIds = movableEntries.map(({ keyframe }) => keyframe.id)
      const anchorEntry = movableEntries[0]
      if (!anchorEntry) return

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        onSelectionChange?.(new Set([...selectedKeyframeIds, ...keyframeIds]), {
          preserveExternalSelection: true,
        })
        return
      }

      if (event.ctrlKey || event.metaKey) {
        const nextSelection = new Set(selectedKeyframeIds)
        for (const keyframeId of keyframeIds) {
          if (nextSelection.has(keyframeId)) {
            nextSelection.delete(keyframeId)
          } else {
            nextSelection.add(keyframeId)
          }
        }
        onSelectionChange?.(nextSelection, { preserveExternalSelection: true })
        return
      }

      const allSelected = keyframeIds.every((keyframeId) => selectedKeyframeIds.has(keyframeId))
      const baseSelection = allSelected ? new Set(selectedKeyframeIds) : new Set(keyframeIds)
      if (!allSelected) {
        onSelectionChange?.(baseSelection)
      }
      onActivePropertyChange?.(anchorEntry.property)
      for (const { property, keyframe } of movableEntries) {
        selectionAnchorByPropertyRef.current.set(property, keyframe.id)
      }

      const selectedIdsForDrag =
        allSelected && baseSelection.size > keyframeIds.length
          ? Array.from(baseSelection)
          : keyframeIds
      const initialFrames = new Map<string, number>()
      for (const keyframeId of selectedIdsForDrag) {
        const meta = keyframeMetaByIdRef.current.get(keyframeId)
        if (!meta) continue
        initialFrames.set(keyframeId, meta.keyframe.frame)
      }

      dragStateRef.current = {
        anchorKeyframeId: anchorEntry.keyframe.id,
        selectedKeyframeIds: selectedIdsForDrag,
        initialFrames,
        startClientX: event.clientX,
        pointerId: event.pointerId,
        started: false,
        duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
        appliedDeltaFrames: 0,
      }
      scheduleDragPreviewFrames(null)

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      onSelectionChange,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
    ],
  )
  const handleRowPointerDown = useCallback(
    (property: AnimatableProperty, event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      beginMarqueeSelection,
      disabled,
      getMarqueeModeFromPointerEvent,
      isPropertyLocked,
      onActivePropertyChange,
      selectedKeyframeIds,
    ],
  )

  const handleTimelineBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [beginMarqueeSelection, disabled, getMarqueeModeFromPointerEvent, selectedKeyframeIds],
  )

  useEffect(() => {
    if (!onKeyframeMove && !onDuplicateKeyframes) return

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = getMatchingDragState(dragStateRef.current, event, disabled)
      if (!dragState) return

      const deltaX = event.clientX - dragState.startClientX
      if (!startDopesheetDrag(dragState, deltaX, onDragStart)) return
      const deltaFrames = getDopesheetDragDelta(
        dragState,
        event,
        effectiveTimelineWidth,
        frameRange,
        totalFrames,
        snapEnabled,
        snapFrame,
      )

      const preview = buildSelectionFramePreview(dragState.selectedKeyframeIds, deltaFrames)
      const externallyHandled =
        !dragState.duplicateOnCommit && (onSelectionFrameDelta?.(deltaFrames, 'preview') ?? false)
      dragState.appliedDeltaFrames = externallyHandled ? deltaFrames : preview.appliedDeltaFrames
      if (!externallyHandled) scheduleDragPreviewFrames(preview.previewFrames)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return

      if (dragState.started) {
        const previewFrames = appliedDragPreviewFramesRef.current
        if (dragState.duplicateOnCommit) {
          duplicateSelectionFramePreview(dragState.selectedKeyframeIds, previewFrames)
        } else {
          const externallyHandled =
            onSelectionFrameDelta?.(dragState.appliedDeltaFrames, 'commit') ?? false
          if (!externallyHandled) {
            commitSelectionFramePreview(dragState.selectedKeyframeIds, previewFrames)
          }
          onDragEnd?.()
        }
      }
      dragStateRef.current = null
      scheduleDragPreviewFrames(null)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return
      if (dragState.started && !dragState.duplicateOnCommit) {
        onSelectionFrameDelta?.(dragState.appliedDeltaFrames, 'cancel')
        onDragCancel?.()
      }
      dragStateRef.current = null
      scheduleDragPreviewFrames(null)
    }

    return addWindowPointerListeners(handlePointerMove, handlePointerUp, handlePointerCancel)
  }, [
    disabled,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    onKeyframeMove,
    onDuplicateKeyframes,
    onDragStart,
    onDragEnd,
    onDragCancel,
    onSelectionFrameDelta,
    effectiveTimelineWidth,
    frameRange,
    totalFrames,
    snapEnabled,
    snapFrame,
    scheduleDragPreviewFrames,
  ])

  const scrubPointerIdRef = useRef<number | null>(null)
  const lastScrubbedFrameRef = useRef<number | null>(null)
  const {
    startScrub: startRulerScrub,
    queueScrub: queueRulerScrub,
    flushPendingScrub: flushPendingRulerScrub,
  } = useCoalescedScrub(onScrub)
  const handleRulerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      event.preventDefault()
      scrubPointerIdRef.current = event.pointerId
      setPointerCaptureSafely(event.currentTarget, event.pointerId)
      const frame = getFrameFromClientX(event.clientX)
      lastScrubbedFrameRef.current = frame
      onScrubStart?.()
      startRulerScrub({
        frame,
        pointerX: getTimelineXFromClientX(event.clientX),
        pixelsPerSecond: timelinePixelsPerSecond,
      })
    },
    [
      disabled,
      getFrameFromClientX,
      getTimelineXFromClientX,
      onScrubStart,
      startRulerScrub,
      timelinePixelsPerSecond,
    ],
  )

  const handleRulerPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (scrubPointerIdRef.current !== event.pointerId) return
      const frame = getFrameFromClientX(event.clientX)
      if (frame === lastScrubbedFrameRef.current) return
      lastScrubbedFrameRef.current = frame
      queueRulerScrub({
        frame,
        pointerX: getTimelineXFromClientX(event.clientX),
        pixelsPerSecond: timelinePixelsPerSecond,
      })
    },
    [
      disabled,
      getFrameFromClientX,
      getTimelineXFromClientX,
      queueRulerScrub,
      timelinePixelsPerSecond,
    ],
  )

  const handleRulerPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scrubPointerIdRef.current !== event.pointerId) return
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore pointer capture errors
      }
      scrubPointerIdRef.current = null
      lastScrubbedFrameRef.current = null
      flushPendingRulerScrub(true)
      onScrubEnd?.()
    },
    [flushPendingRulerScrub, onScrubEnd],
  )

  // Standard scroll model, shared by the sheet-only and split-sheet panes:
  // - Ctrl/Cmd+wheel zooms the time axis about the cursor.
  // - Shift+wheel / trackpad horizontal swipe pans the time axis.
  // - Plain vertical wheel is left to bubble so the property rows scroll
  //   natively (their container is `overflow-auto`); it never hijacks the time
  //   axis.
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (disabled) return

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const pivotFrame = getFrameFromClientX(event.clientX)
        zoomAroundFrame(pivotFrame, event.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR)
        return
      }

      const horizontalDelta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0
      if (horizontalDelta !== 0) {
        event.preventDefault()
        panFrames(Math.round((horizontalDelta / effectiveTimelineWidth) * frameRange))
        return
      }

      // Plain vertical wheel: let the rows scroll natively (no preventDefault).
    },
    [disabled, getFrameFromClientX, zoomAroundFrame, panFrames, effectiveTimelineWidth, frameRange],
  )

  const graphDisplayProperty = useMemo(() => {
    if (graphVisibleProperties.size === 0) return null
    const graphableSet = new Set(graphableProperties)
    // Honour the selection when it has a drawable curve.
    if (
      activeSelectedProperty &&
      graphVisibleProperties.has(activeSelectedProperty) &&
      graphableSet.has(activeSelectedProperty)
    ) {
      return activeSelectedProperty
    }
    // Otherwise show the first visible property that actually has a curve, so the
    // graph isn't blank when the selection is a single-keyframe property.
    const graphableVisible = [...graphVisibleProperties].find((property) =>
      graphableSet.has(property),
    )
    if (graphableVisible) return graphableVisible
    // Fall back to the selection even without a full curve.
    if (activeSelectedProperty && graphVisibleProperties.has(activeSelectedProperty)) {
      return activeSelectedProperty
    }
    return null
  }, [activeSelectedProperty, graphVisibleProperties, graphableProperties])
  const graphDisplayPropertyLocked = graphDisplayProperty
    ? isPropertyLocked(graphDisplayProperty)
    : false
  const focusGraphPane = useCallback(() => {
    // `preventScroll` is essential: focusing a tabIndex={-1} element inside a
    // scrollable container makes the browser scroll it into view. Without this,
    // pressing a keyframe (which focuses the pane via onPointerDownCapture)
    // shifts the entire dopesheet scroll.
    graphPaneRef.current?.focus({ preventScroll: true })
  }, [])
  const handleGraphPaneKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled || graphDisplayPropertyLocked || selectedRefs.length === 0) {
        return
      }

      const hasModifier = event.ctrlKey || event.metaKey || event.altKey

      if (!hasModifier && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (!onRemoveKeyframes) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onRemoveKeyframes(selectedRefs)
        return
      }

      if (!hasModifier && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        event.stopPropagation()
        nudgeSelectedKeyframes(
          event.key === 'ArrowLeft' ? (event.shiftKey ? -10 : -1) : event.shiftKey ? 10 : 1,
        )
      }
    },
    [disabled, graphDisplayPropertyLocked, nudgeSelectedKeyframes, onRemoveKeyframes, selectedRefs],
  )
  const timingStripMarkers = useMemo(() => {
    if (showGraphPane) {
      if (!activeSelectedProperty) {
        return []
      }

      return (keyframesByProperty[activeSelectedProperty] ?? []).map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: selectedKeyframeIds.has(keyframe.id),
        draggable: !!onKeyframeMove && selectedRefIds.includes(keyframe.id),
      }))
    }

    return visibleKeyframes
      .filter(({ keyframe }) => selectedKeyframeIds.has(keyframe.id))
      .map(({ property, keyframe }) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: true,
        draggable: !!onKeyframeMove && !isPropertyLocked(property),
      }))
  }, [
    activeSelectedProperty,
    isPropertyLocked,
    keyframesByProperty,
    onKeyframeMove,
    selectedKeyframeIds,
    selectedRefIds,
    visibleKeyframes,
    showGraphPane,
  ])
  const constrainGraphFrameDelta = useCallback(
    (deltaFrames: number, draggedKeyframeIds: string[]) =>
      constrainSelectedKeyframeDelta({
        keyframesByProperty,
        selectedKeyframeIds: new Set(draggedKeyframeIds),
        totalFrames,
        deltaFrames,
      }),
    [keyframesByProperty, totalFrames],
  )
  const {
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  } = useTimingStripDrag({
    disabled,
    onKeyframeMove,
    onSelectionChange,
    onDragStart,
    onDragEnd,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
  })

  // Mirror timing-strip preview into the sheet drag preview. The sheet shows in
  // both `dopesheet` and `split`, so mirror whenever the sheet pane is visible.
  useEffect(() => {
    if (!showSheetPane) {
      scheduleDragPreviewFrames(null)
      return
    }

    scheduleDragPreviewFrames(timingStripPreviewFrames)
  }, [scheduleDragPreviewFrames, timingStripPreviewFrames, showSheetPane])
  const formatRulerTick = useCallback(
    (frame: number): string => {
      if (graphRulerUnit === 'frames' || !fps || fps <= 0) {
        return String(frame)
      }
      const seconds = frame / fps
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60)
        const remainder = seconds - minutes * 60
        return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
      }
      return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
    },
    [graphRulerUnit, fps],
  )

  const rulerTickElements = useMemo(
    () =>
      ticks.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/60"
          style={{ left: Math.round(frameToX(frame)) }}
        >
          <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">
            {formatRulerTick(frame)}
          </span>
        </div>
      )),
    [ticks, frameToX, formatRulerTick],
  )
  const renderPropertyRowContent = useCallback(
    (row: DopesheetPropertyRow, options?: { indented?: boolean }) => {
      const rowLocked = isPropertyLocked(row.property)
      const compoundRow = compoundPropertyRows[row.property]
      const curveVisible = singleCurveMode
        ? (showGraphPane || selectedCurveVisibleExternally) && selectedProperty === row.property
        : graphVisibleProperties.has(row.property)
      const rowLabel = compoundRow?.label ?? getKeyframePropertyLabel(t, row.property)
      const rowDisplayLabel = compoundRow?.label ?? getKeyframePropertyShortLabel(t, row.property)
      const linkableProperty: DirectLinkableProperty | null =
        compoundRow?.linkProperty ??
        (isLinkableAnimatableProperty(row.property) ? row.property : null)
      const propertyLink = linkableProperty
        ? resolvedPropertyLinks.find((link) => link.targetProperty === linkableProperty)
        : undefined
      const propertyExpression = linkableProperty
        ? propertyExpressions.find((expression) => expression.targetProperty === linkableProperty)
        : undefined
      const preExpressionValue: ExpressionValue | undefined = compoundRow
        ? (compoundRow.preExpressionValue ?? compoundRow.value)
        : (preExpressionPropertyValues[row.property] ?? propertyValues[row.property])
      const postExpressionValue: ExpressionValue | undefined = compoundRow
        ? compoundRow.value
        : propertyValues[row.property]
      const editedExpression =
        linkableProperty && expressionEditor?.property === linkableProperty
          ? expressionEditor
          : null
      const expressionPreview =
        linkableProperty &&
        preExpressionValue !== undefined &&
        (editedExpression || propertyExpression)
          ? evaluatePropertyExpression(
              editedExpression?.source ?? propertyExpression?.source ?? 'value',
              {
                preValue: preExpressionValue,
                globalFrame: globalFrame ?? itemFrom + currentFrame,
                fps,
                resolveProperty: (sourceItemId, sourceProperty) =>
                  resolveExpressionReference?.(sourceItemId, sourceProperty) ?? null,
              },
            )
          : undefined
      const expressionError =
        expressionPreview?.error ??
        (linkableProperty &&
        expressionPreview &&
        !isExpressionValueCompatible(linkableProperty, expressionPreview.value)
          ? 'Expression result has the wrong value type'
          : undefined)
      const canResetEffectProperty =
        isEffectAnimatableProperty(row.property) &&
        !!onResetPropertiesToDefault &&
        !disabled &&
        !rowLocked
      const canResetRow = canResetEffectProperty || canClearRow(row)
      const resetRowLabel = t(
        canResetEffectProperty
          ? 'timeline.keyframeEditor.resetEffectPropertyDefault'
          : 'timeline.keyframeEditor.resetPropertyAnimation',
        {
          property: rowLabel,
          defaultValue: canResetEffectProperty
            ? `Reset ${rowLabel} to its default value`
            : `Reset ${rowLabel} animation to its base value`,
        },
      )

      return (
        <div
          className={cn(
            'group h-full px-1 flex items-center gap-px bg-muted/8',
            // Indent child property rows under their group header and draw a
            // faint vertical spine so the column reads as a tree.
            options?.indented &&
              "relative pl-6 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/40 before:content-['']",
            row.controls.hasKeyframeAtCurrentFrame &&
              (presentation === 'lanes' ? 'bg-accent/70' : 'bg-primary/10'),
            showGraphPane && graphVisibleProperties.has(row.property) && 'bg-accent/40',
            selectedProperty === row.property && 'bg-accent/55',
            showGraphPane && !rowLocked && 'cursor-pointer',
            rowLocked && 'opacity-70',
            'data-[expression-link-hover=true]:bg-primary/20 data-[expression-link-hover=true]:ring-1 data-[expression-link-hover=true]:ring-inset data-[expression-link-hover=true]:ring-primary/70',
            'data-[expression-reference-hover=true]:bg-sky-500/15 data-[expression-reference-hover=true]:ring-1 data-[expression-reference-hover=true]:ring-inset data-[expression-reference-hover=true]:ring-sky-400/70',
          )}
          data-expression-item-id={linkableProperty ? itemId : undefined}
          data-expression-property={linkableProperty ?? undefined}
          onClick={showGraphPane && !rowLocked ? () => activateProperty(row.property) : undefined}
        >
          <div className="flex items-center gap-px self-stretch">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                curveVisible
                  ? 'text-orange-500 hover:text-orange-400'
                  : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                if (singleCurveMode) {
                  if (curveVisible) {
                    onCurveVisibilityChange?.(row.property, false)
                  } else {
                    showSinglePropertyCurve(row.property)
                  }
                  return
                }
                togglePropertyCurve(row.property)
              }}
              title={t('timeline.keyframeEditor.showPropertyCurve', {
                property: rowLabel,
                defaultValue: `Show ${rowLabel} curve`,
              })}
              aria-label={t('timeline.keyframeEditor.showPropertyCurve', {
                property: rowLabel,
                defaultValue: `Show ${rowLabel} curve`,
              })}
              aria-pressed={curveVisible}
            >
              <LineChart className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                rowLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                toggleLockedProperty(row.property)
              }}
              title={
                rowLocked
                  ? t('timeline.keyframeEditor.unlockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Unlock ${rowLabel} row`,
                    })
                  : t('timeline.keyframeEditor.lockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Lock ${rowLabel} row`,
                    })
              }
              aria-label={
                rowLocked
                  ? t('timeline.keyframeEditor.unlockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Unlock ${rowLabel} row`,
                    })
                  : t('timeline.keyframeEditor.lockPropertyRow', {
                      property: rowLabel,
                      defaultValue: `Lock ${rowLabel} row`,
                    })
              }
              aria-pressed={rowLocked}
            >
              <Lock className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                autoKeyEnabledByProperty[row.property] &&
                  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
              )}
              onClick={() => handleRowAutoKeyToggle(row.property)}
              disabled={disabled || rowLocked || !onPropertyValueCommit}
              title={
                autoKeyEnabledByProperty[row.property]
                  ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
                      target: rowLabel,
                      defaultValue: `Auto-key enabled for ${rowLabel}`,
                    })
                  : t('timeline.keyframeEditor.enableAutoKeyFor', {
                      target: rowLabel,
                      defaultValue: `Enable auto-key for ${rowLabel}`,
                    })
              }
              aria-label={
                autoKeyEnabledByProperty[row.property]
                  ? t('timeline.keyframeEditor.autoKeyEnabledFor', {
                      target: rowLabel,
                      defaultValue: `Auto-key enabled for ${rowLabel}`,
                    })
                  : t('timeline.keyframeEditor.enableAutoKeyFor', {
                      target: rowLabel,
                      defaultValue: `Enable auto-key for ${rowLabel}`,
                    })
              }
              aria-pressed={autoKeyEnabledByProperty[row.property] ?? false}
            >
              <Timer className={MINI_ICON_CLASS} />
            </Button>
            {linkableProperty && beginPropertyLink ? (
              propertyLink ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        MINI_ICON_BUTTON_CLASS,
                        'self-center text-orange-400 hover:bg-orange-500/10 hover:text-orange-300',
                      )}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        beginPropertyLink(event, linkableProperty)
                      }}
                      title={t('timeline.keyframeEditor.linkedExpression', {
                        source:
                          resolvedPropertyLinkSourceLabels[linkableProperty] ??
                          propertyLink.sourceProperty,
                        defaultValue: `Linked to ${resolvedPropertyLinkSourceLabels[linkableProperty] ?? propertyLink.sourceProperty}. Drag to re-link or click for options.`,
                      })}
                      aria-label={t('timeline.keyframeEditor.linkedExpression', {
                        source:
                          resolvedPropertyLinkSourceLabels[linkableProperty] ??
                          propertyLink.sourceProperty,
                        defaultValue: `Linked to ${resolvedPropertyLinkSourceLabels[linkableProperty] ?? propertyLink.sourceProperty}`,
                      })}
                    >
                      <PickWhipIcon className={MINI_ICON_CLASS} data-testid="pick-whip-icon" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-56 space-y-2 p-2">
                    <div className="text-[10px] font-medium text-foreground">
                      {t('timeline.keyframeEditor.propertyLink', {
                        defaultValue: 'Property link',
                      })}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {resolvedPropertyLinkSourceLabels[linkableProperty] ??
                        propertyLink.sourceProperty}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full justify-start px-2 text-[10px] text-destructive hover:text-destructive"
                      onClick={() => removePropertyLink?.(linkableProperty)}
                    >
                      <Unlink className="mr-1.5 h-3 w-3" />
                      {t('timeline.keyframeEditor.removePropertyLink', {
                        defaultValue: 'Remove property link',
                      })}
                    </Button>
                  </PopoverContent>
                </Popover>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    MINI_ICON_BUTTON_CLASS,
                    'self-center touch-none text-muted-foreground opacity-30 hover:text-foreground hover:opacity-70',
                  )}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    beginPropertyLink(event, linkableProperty)
                  }}
                  title={t('timeline.keyframeEditor.dragToLinkProperty', {
                    property: rowLabel,
                    defaultValue: `Drag to link ${rowLabel} to another property`,
                  })}
                  aria-label={t('timeline.keyframeEditor.dragToLinkProperty', {
                    property: rowLabel,
                    defaultValue: `Drag to link ${rowLabel} to another property`,
                  })}
                >
                  <PickWhipIcon className={MINI_ICON_CLASS} data-testid="pick-whip-icon" />
                </Button>
              )
            ) : null}
            {linkableProperty && onSetPropertyExpression ? (
              <Popover
                open={expressionEditor?.property === linkableProperty}
                onOpenChange={(open) => {
                  if (!open) {
                    setExpressionEditor((current) =>
                      current?.property === linkableProperty ? null : current,
                    )
                    return
                  }
                  const source = propertyExpression?.source ?? 'value'
                  setExpressionEditor({
                    property: linkableProperty,
                    source,
                    enabled: propertyExpression?.enabled ?? true,
                    selectionStart: source.length,
                    selectionEnd: source.length,
                  })
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                      MINI_ICON_BUTTON_CLASS,
                      'self-center hover:bg-sky-500/10 hover:text-sky-300',
                      propertyExpression
                        ? expressionError
                          ? 'text-red-400'
                          : propertyExpression.enabled
                            ? 'text-sky-400'
                            : 'text-muted-foreground opacity-50'
                        : 'text-muted-foreground opacity-30 hover:opacity-70',
                    )}
                    title={
                      propertyExpression
                        ? `Edit ${rowLabel} expression`
                        : `Add ${rowLabel} expression`
                    }
                    aria-label={
                      propertyExpression
                        ? `Edit ${rowLabel} expression`
                        : `Add ${rowLabel} expression`
                    }
                  >
                    <Braces className={MINI_ICON_CLASS} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-80 space-y-2 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-foreground">
                        {rowLabel} expression
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        Sandboxed and deterministic
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-6 px-2 text-[10px]',
                        editedExpression?.enabled ? 'text-sky-300' : 'text-muted-foreground',
                      )}
                      aria-pressed={editedExpression?.enabled ?? false}
                      onClick={() =>
                        setExpressionEditor((current) =>
                          current?.property === linkableProperty
                            ? { ...current, enabled: !current.enabled }
                            : current,
                        )
                      }
                    >
                      {editedExpression?.enabled ? 'Enabled' : 'Disabled'}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[9px]">
                    <div className="rounded border border-border/70 bg-background/70 px-2 py-1">
                      <div className="text-muted-foreground">Pre-expression</div>
                      <div className="truncate font-mono text-foreground">
                        {formatExpressionValue(preExpressionValue)}
                      </div>
                    </div>
                    <div className="rounded border border-border/70 bg-background/70 px-2 py-1">
                      <div className="text-muted-foreground">Post-expression</div>
                      <div className="truncate font-mono text-foreground">
                        {formatExpressionValue(postExpressionValue)}
                      </div>
                    </div>
                  </div>
                  <textarea
                    ref={expressionTextareaRef}
                    autoFocus
                    spellCheck={false}
                    value={editedExpression?.source ?? ''}
                    onChange={(event) => {
                      const source = event.target.value
                      setExpressionEditor((current) =>
                        current?.property === linkableProperty
                          ? {
                              ...current,
                              source,
                              selectionStart: event.target.selectionStart,
                              selectionEnd: event.target.selectionEnd,
                            }
                          : current,
                      )
                    }}
                    onSelect={(event) => {
                      const target = event.currentTarget
                      setExpressionEditor((current) =>
                        current?.property === linkableProperty
                          ? {
                              ...current,
                              selectionStart: target.selectionStart,
                              selectionEnd: target.selectionEnd,
                            }
                          : current,
                      )
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                        event.preventDefault()
                        if (!editedExpression || expressionError) return
                        onSetPropertyExpression(
                          linkableProperty,
                          editedExpression.source,
                          editedExpression.enabled,
                        )
                        setExpressionEditor(null)
                      }
                    }}
                    className={cn(
                      'h-24 w-full resize-y rounded border bg-background px-2 py-1.5 font-mono text-[10px] leading-4 text-foreground outline-none focus:border-sky-500/70',
                      expressionError ? 'border-red-500/60' : 'border-border',
                    )}
                    aria-label={`${rowLabel} expression source`}
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-sky-300"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        const textarea = expressionTextareaRef.current
                        beginExpressionReferenceDrag(event, {
                          itemId,
                          property: linkableProperty,
                          selectionStart:
                            textarea?.selectionStart ?? editedExpression?.selectionStart ?? 0,
                          selectionEnd:
                            textarea?.selectionEnd ?? editedExpression?.selectionEnd ?? 0,
                        })
                      }}
                      aria-label={`Expression pick whip for ${rowLabel}`}
                      title="Drag to a property to insert its reference at the cursor"
                    >
                      <PickWhipIcon className="h-3 w-3" />
                      Insert reference
                    </Button>
                    <span className="ml-auto text-[9px] text-muted-foreground">
                      Ctrl/Cmd+Enter to apply
                    </span>
                  </div>
                  {expressionError ? (
                    <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] text-red-300">
                      {expressionError}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end gap-1 border-t border-border/60 pt-2">
                    {propertyExpression ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mr-auto h-7 px-2 text-[10px] text-destructive hover:text-destructive"
                        onClick={() => {
                          onRemovePropertyExpression?.(linkableProperty)
                          setExpressionEditor(null)
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setExpressionEditor(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      disabled={!editedExpression || !!expressionError}
                      onClick={() => {
                        if (!editedExpression) return
                        onSetPropertyExpression(
                          linkableProperty,
                          editedExpression.source,
                          editedExpression.enabled,
                        )
                        setExpressionEditor(null)
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
          <div
            className={cn(
              'flex h-full min-w-0 items-center truncate pr-1 text-[9px] font-medium leading-none text-foreground/90',
              compoundRow ? 'w-[54px] shrink-0 pl-1' : 'flex-1 pl-[10px]',
            )}
            title={rowLabel}
          >
            {rowDisplayLabel}
          </div>
          <div className="ml-auto flex items-center gap-0">
            {compoundRow ? (
              <CompoundPropertyInputs
                spacious={spacious}
                config={{
                  ...compoundRow,
                  disabled:
                    compoundRow.disabled ||
                    disabled ||
                    rowLocked ||
                    !!propertyLink ||
                    (!row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked),
                  linked: !!propertyLink,
                  allowCreateOnBlur: autoKeyEnabledByProperty[row.property] ?? false,
                }}
              />
            ) : (
              <Input
                type={isColorAnimatableProperty(row.property) ? 'text' : 'number'}
                value={valueDrafts[row.property] ?? ''}
                onChange={(event) => handleRowValueChange(row.property, event.target.value)}
                onPointerDown={(event) => handleValueScrubStart(event, row.property)}
                onPointerMove={(event) => handleValueScrubMove(event, row.property)}
                onPointerUp={(event) => handleValueScrubEnd(event, row.property)}
                onPointerCancel={(event) => handleValueScrubEnd(event, row.property)}
                onFocus={() => {
                  activateProperty(row.property)
                  setEditingValueProperty(row.property)
                  valueDraftAtFocusRef.current[row.property] = valueDrafts[row.property] ?? ''
                }}
                onBlur={() => {
                  const draftChanged =
                    valueDraftAtFocusRef.current[row.property] !== (valueDrafts[row.property] ?? '')
                  delete valueDraftAtFocusRef.current[row.property]
                  if (skipNextBlurCommitPropertyRef.current === row.property) {
                    skipNextBlurCommitPropertyRef.current = null
                  } else if (draftChanged) {
                    handleRowValueCommit(row.property, {
                      allowCreate: autoKeyEnabledByProperty[row.property] ?? false,
                    })
                  }
                  setEditingValueProperty((current) => (current === row.property ? null : current))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    skipNextBlurCommitPropertyRef.current = row.property
                    handleRowValueCommit(row.property, { allowCreate: true })
                    setEditingValueProperty((current) =>
                      current === row.property ? null : current,
                    )
                    event.currentTarget.blur()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    skipNextBlurCommitPropertyRef.current = row.property
                    setValueDrafts((prev) => ({
                      ...prev,
                      [row.property]: formatPropertyValue(
                        row.property,
                        propertyValues[row.property],
                      ),
                    }))
                    setEditingValueProperty((current) =>
                      current === row.property ? null : current,
                    )
                    event.currentTarget.blur()
                  }
                }}
                step={
                  isColorAnimatableProperty(row.property)
                    ? undefined
                    : (PROPERTY_VALUE_RANGES[row.property]?.decimals ?? 2) === 0
                      ? 1
                      : 0.1
                }
                min={
                  isColorAnimatableProperty(row.property)
                    ? undefined
                    : PROPERTY_VALUE_RANGES[row.property]?.min
                }
                max={
                  isColorAnimatableProperty(row.property)
                    ? undefined
                    : PROPERTY_VALUE_RANGES[row.property]?.max
                }
                inputMode={isColorAnimatableProperty(row.property) ? 'text' : 'decimal'}
                className={cn(
                  'h-5 border-border/70 bg-background/85 px-1.5 py-0 text-right text-[10px] leading-none tabular-nums md:text-[10px]',
                  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                  isColorAnimatableProperty(row.property)
                    ? 'w-[68px]'
                    : spacious
                      ? 'w-[80px]'
                      : 'w-[44px]',
                  !isColorAnimatableProperty(row.property) && 'cursor-ew-resize select-none',
                  propertyLink && 'text-orange-400',
                )}
                disabled={
                  disabled ||
                  rowLocked ||
                  !!propertyLink ||
                  !onPropertyValueCommit ||
                  (!row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked)
                }
                aria-label={t('timeline.keyframeEditor.propertyValueAtPlayhead', {
                  property: rowLabel,
                  defaultValue: `${rowLabel} value at playhead`,
                })}
                title={t('timeline.keyframeEditor.scrubPropertyValue', {
                  property: rowLabel,
                  defaultValue: `Drag horizontally to adjust ${rowLabel}. Hold Shift for fine or Alt for ultra-fine control.`,
                })}
              />
            )}
            <div className="flex items-center gap-0 rounded-sm border border-border/70 bg-background/85 px-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => handleRowNavigate(row.property, row.controls.prevKeyframe)}
                disabled={disabled || row.controls.prevKeyframe === null || !onNavigateToKeyframe}
                title={t('timeline.keyframeEditor.previousPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Previous ${rowLabel} keyframe`,
                })}
                aria-label={t('timeline.keyframeEditor.previousPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Previous ${rowLabel} keyframe`,
                })}
              >
                <ChevronLeft className="h-[9px] w-[9px]" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-5 w-5 p-0 hover:bg-transparent',
                  row.controls.hasKeyframeAtCurrentFrame
                    ? 'text-neutral-200 hover:text-neutral-200'
                    : 'text-muted-foreground hover:text-foreground',
                  isCurrentFrameBlocked &&
                    !row.controls.hasKeyframeAtCurrentFrame &&
                    'opacity-40 cursor-not-allowed',
                )}
                onClick={() => handleRowToggleKeyframe(row.property, row.controls.currentKeyframes)}
                disabled={
                  disabled ||
                  rowLocked ||
                  (!row.controls.hasKeyframeAtCurrentFrame &&
                    (isCurrentFrameBlocked || !onAddKeyframe))
                }
                title={
                  !row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked
                    ? t('timeline.keyframeEditor.transitionBlocked')
                    : row.controls.hasKeyframeAtCurrentFrame
                      ? t('timeline.keyframeEditor.removePropertyKeyframeAtPlayhead', {
                          property: rowLabel,
                          defaultValue: `Remove ${rowLabel} keyframe at playhead`,
                        })
                      : t('timeline.keyframeEditor.togglePropertyKeyframeAtPlayhead', {
                          property: rowLabel,
                          defaultValue: `Toggle ${rowLabel} keyframe at playhead`,
                        })
                }
                aria-label={
                  !row.controls.hasKeyframeAtCurrentFrame && isCurrentFrameBlocked
                    ? t('timeline.keyframeEditor.transitionBlocked')
                    : row.controls.hasKeyframeAtCurrentFrame
                      ? t('timeline.keyframeEditor.removePropertyKeyframeAtPlayhead', {
                          property: rowLabel,
                          defaultValue: `Remove ${rowLabel} keyframe at playhead`,
                        })
                      : t('timeline.keyframeEditor.togglePropertyKeyframeAtPlayhead', {
                          property: rowLabel,
                          defaultValue: `Toggle ${rowLabel} keyframe at playhead`,
                        })
                }
              >
                <span
                  className={cn(
                    'block h-[7px] w-[7px] rotate-45 border transition-colors',
                    row.controls.hasKeyframeAtCurrentFrame
                      ? 'border-neutral-200 bg-neutral-200'
                      : 'border-current bg-transparent',
                  )}
                />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => handleRowNavigate(row.property, row.controls.nextKeyframe)}
                disabled={disabled || row.controls.nextKeyframe === null || !onNavigateToKeyframe}
                title={t('timeline.keyframeEditor.nextPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Next ${rowLabel} keyframe`,
                })}
                aria-label={t('timeline.keyframeEditor.nextPropertyKeyframe', {
                  property: rowLabel,
                  defaultValue: `Next ${rowLabel} keyframe`,
                })}
              >
                <ChevronRight className="h-[9px] w-[9px]" />
              </Button>
            </div>
            {canResetRow ? (
              <DopesheetResetButton
                label={resetRowLabel}
                onReset={() => {
                  if (canResetEffectProperty) {
                    onResetPropertiesToDefault?.([row.property])
                  } else {
                    handleClearProperty(row.property)
                  }
                }}
              />
            ) : (
              <span
                aria-hidden="true"
                className={MINI_ICON_BUTTON_CLASS}
                data-testid={`dopesheet-row-reset-spacer-${row.property}`}
              />
            )}
          </div>
        </div>
      )
    },
    [
      activateProperty,
      canClearRow,
      compoundPropertyRows,
      autoKeyEnabledByProperty,
      disabled,
      formatPropertyValue,
      graphVisibleProperties,
      handleClearProperty,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      handleValueScrubEnd,
      handleValueScrubMove,
      handleValueScrubStart,
      itemId,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onAddKeyframe,
      onNavigateToKeyframe,
      onCurveVisibilityChange,
      onPropertyValueCommit,
      resolvedPropertyLinks,
      resolvedPropertyLinkSourceLabels,
      beginPropertyLink,
      removePropertyLink,
      propertyExpressions,
      preExpressionPropertyValues,
      expressionEditor,
      resolveExpressionReference,
      globalFrame,
      itemFrom,
      currentFrame,
      fps,
      onSetPropertyExpression,
      onRemovePropertyExpression,
      beginExpressionReferenceDrag,
      onResetPropertiesToDefault,
      propertyValues,
      presentation,
      selectedProperty,
      selectedCurveVisibleExternally,
      t,
      togglePropertyCurve,
      toggleLockedProperty,
      valueDrafts,
      showGraphPane,
      showSinglePropertyCurve,
      singleCurveMode,
      spacious,
    ],
  )
  const renderGroupHeaderContent = useCallback(
    (group: DopesheetPropertyGroup) => {
      const groupLabel = getKeyframeGroupLabel(t, group.id, group.label)
      const groupProperties = group.rows.map((row) => row.property)
      const curveVisible = groupProperties.some((p) => graphVisibleProperties.has(p))
      const allRowsLocked =
        group.rows.length > 0 && group.rows.every((row) => isPropertyLocked(row.property))
      const canClearAny = group.rows.some((row) => canClearRow(row))
      const isEffectGroup = group.rows.every((row) => isEffectAnimatableProperty(row.property))
      const canResetEffectGroup =
        isEffectGroup &&
        !!onResetPropertiesToDefault &&
        !disabled &&
        group.rows.some((row) => !isPropertyLocked(row.property))
      const canResetGroup = canResetEffectGroup || canClearAny
      const resetGroupLabel = t(
        canResetEffectGroup
          ? 'timeline.keyframeEditor.resetEffectGroupDefault'
          : 'timeline.keyframeEditor.resetGroupAnimation',
        {
          group: groupLabel,
          defaultValue: canResetEffectGroup
            ? `Reset all ${groupLabel} properties to their default values`
            : `Reset all ${groupLabel} animations to their base values`,
        },
      )
      const isOpen = expandedGroups[group.id] ?? true

      return (
        <div className="group flex h-full items-center gap-px border-y border-border/60 bg-muted/70 pl-3 pr-0.5">
          <div className="flex items-center gap-px self-stretch">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                curveVisible
                  ? 'text-orange-500 hover:text-orange-400'
                  : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                toggleGroupCurves(groupProperties)
              }}
              disabled={groupProperties.length === 0}
              title={t('timeline.keyframeEditor.showAllGroupCurves', {
                group: groupLabel,
                defaultValue: `Show all ${groupLabel} curves`,
              })}
              aria-label={t('timeline.keyframeEditor.showAllGroupCurves', {
                group: groupLabel,
                defaultValue: `Show all ${groupLabel} curves`,
              })}
              aria-pressed={curveVisible}
            >
              <LineChart className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                MINI_ICON_BUTTON_CLASS,
                'self-center text-muted-foreground hover:text-foreground',
                allRowsLocked ? 'text-red-400 hover:text-red-300' : 'opacity-30 hover:opacity-60',
              )}
              onClick={(event) => {
                event.stopPropagation()
                setGroupLocked(groupProperties, !allRowsLocked)
              }}
              disabled={groupProperties.length === 0}
              title={
                allRowsLocked
                  ? t('timeline.keyframeEditor.unlockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Unlock ${groupLabel} rows`,
                    })
                  : t('timeline.keyframeEditor.lockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Lock ${groupLabel} rows`,
                    })
              }
              aria-label={
                allRowsLocked
                  ? t('timeline.keyframeEditor.unlockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Unlock ${groupLabel} rows`,
                    })
                  : t('timeline.keyframeEditor.lockGroupRows', {
                      group: groupLabel,
                      defaultValue: `Lock ${groupLabel} rows`,
                    })
              }
              aria-pressed={allRowsLocked}
            >
              <Lock className={MINI_ICON_CLASS} />
            </Button>
          </div>
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-center gap-px rounded-sm px-0 text-left leading-none transition-colors hover:bg-background/40"
            onClick={(event) => {
              if (event.shiftKey) {
                setAllGroupsExpanded(!isOpen)
                return
              }
              toggleGroup(group.id)
            }}
            title={t('timeline.keyframeEditor.shiftToggleAllGroups', {
              defaultValue: 'Shift-click to expand or collapse all property groups',
            })}
            aria-expanded={isOpen}
            aria-label={
              isOpen
                ? t('timeline.keyframeEditor.collapseGroup', {
                    group: groupLabel,
                    defaultValue: `Collapse ${groupLabel}`,
                  })
                : t('timeline.keyframeEditor.expandGroup', {
                    group: groupLabel,
                    defaultValue: `Expand ${groupLabel}`,
                  })
            }
          >
            {isOpen ? (
              <ChevronDown
                className={cn(
                  MINI_ICON_CLASS,
                  'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80',
                )}
              />
            ) : (
              <ChevronRight
                className={cn(
                  MINI_ICON_CLASS,
                  'flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/80',
                )}
              />
            )}
            <span className="truncate pl-px text-[9px] font-semibold uppercase leading-none tracking-[0.08em] text-foreground">
              {groupLabel}
            </span>
          </button>
          <div className="ml-auto flex items-center gap-0 rounded-sm border border-border/70 bg-background/90 px-px shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
              onClick={(event) => {
                event.stopPropagation()
                handleRowNavigate(
                  group.prevKeyframe?.property ?? group.rows[0]?.property ?? 'x',
                  group.prevKeyframe?.keyframe ?? null,
                )
              }}
              disabled={disabled || group.prevKeyframe === null || !onNavigateToKeyframe}
              title={t('timeline.keyframeEditor.previousGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Previous ${groupLabel} keyframe`,
              })}
              aria-label={t('timeline.keyframeEditor.previousGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Previous ${groupLabel} keyframe`,
              })}
            >
              <ChevronLeft className={MINI_ICON_CLASS} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(MINI_ICON_BUTTON_CLASS, 'text-muted-foreground hover:text-foreground')}
              onClick={(event) => {
                event.stopPropagation()
                handleRowNavigate(
                  group.nextKeyframe?.property ?? group.rows[0]?.property ?? 'x',
                  group.nextKeyframe?.keyframe ?? null,
                )
              }}
              disabled={disabled || group.nextKeyframe === null || !onNavigateToKeyframe}
              title={t('timeline.keyframeEditor.nextGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Next ${groupLabel} keyframe`,
              })}
              aria-label={t('timeline.keyframeEditor.nextGroupKeyframe', {
                group: groupLabel,
                defaultValue: `Next ${groupLabel} keyframe`,
              })}
            >
              <ChevronRight className={MINI_ICON_CLASS} />
            </Button>
            {canResetGroup ? (
              <DopesheetResetButton
                label={resetGroupLabel}
                onReset={() => {
                  if (canResetEffectGroup) {
                    onResetPropertiesToDefault?.(groupProperties)
                  } else {
                    handleClearGroup(group)
                  }
                }}
              />
            ) : (
              <span
                aria-hidden="true"
                className={MINI_ICON_BUTTON_CLASS}
                data-testid={`dopesheet-group-reset-spacer-${group.id}`}
              />
            )}
          </div>
        </div>
      )
    },
    [
      canClearRow,
      disabled,
      expandedGroups,
      handleClearGroup,
      handleRowNavigate,
      graphVisibleProperties,
      isPropertyLocked,
      onNavigateToKeyframe,
      onResetPropertiesToDefault,
      setAllGroupsExpanded,
      setGroupLocked,
      t,
      toggleGroupCurves,
      toggleGroup,
    ],
  )
  // The property controls are substantially heavier than the timeline cells,
  // but their output does not depend on the time viewport. Cache those React
  // nodes separately so zooming only reconciles keyframe/tick geometry.
  const sheetPropertyContentByProperty = useMemo(() => {
    const content = new Map<AnimatableProperty, React.ReactNode>()
    for (const entry of renderedSheetEntries.entries) {
      if (entry.type !== 'row') continue
      content.set(
        entry.row.property,
        renderPropertyRowContent(entry.row, { indented: entry.indented }),
      )
    }
    return content
  }, [renderPropertyRowContent, renderedSheetEntries.entries])
  const sheetGroupContentById = useMemo(() => {
    const content = new Map<string, React.ReactNode>()
    for (const entry of renderedSheetEntries.entries) {
      if (entry.type !== 'group') continue
      content.set(entry.group.id, renderGroupHeaderContent(entry.group))
    }
    return content
  }, [renderGroupHeaderContent, renderedSheetEntries.entries])
  const groupTimelineRowStyle = useMemo(
    () => ({
      ...propertyGridStyle,
      height: GROUP_HEADER_HEIGHT,
      contentVisibility: presentation === 'lanes' ? ('auto' as const) : undefined,
      containIntrinsicSize: presentation === 'lanes' ? `auto ${GROUP_HEADER_HEIGHT}px` : undefined,
    }),
    [presentation, propertyGridStyle],
  )
  const propertyTimelineRowStyle = useMemo(
    () => ({
      ...propertyGridStyle,
      height: ROW_HEIGHT,
      contentVisibility: presentation === 'lanes' ? ('auto' as const) : undefined,
      containIntrinsicSize: presentation === 'lanes' ? `auto ${ROW_HEIGHT}px` : undefined,
    }),
    [presentation, propertyGridStyle],
  )
  const rowElements = useMemo(
    () =>
      renderedSheetEntries.entries.map((entry) => {
        if (entry.type === 'group') {
          return (
            <div
              key={entry.group.id}
              className="grid w-full border-b border-border/60"
              style={groupTimelineRowStyle}
            >
              {sheetGroupContentById.get(entry.group.id)}
              <TimelineViewportCuller>
                <GroupTimelineCell
                  groupId={entry.group.id}
                  groupLabel={entry.group.label}
                  expanded={expandedGroups[entry.group.id] ?? true}
                  frameGroups={
                    groupTimelineById.get(entry.group.id)?.frameGroups ?? EMPTY_FRAME_GROUPS
                  }
                  rows={groupTimelineById.get(entry.group.id)?.rows ?? EMPTY_STRUCTURE_ROWS}
                  ticks={ticks}
                  axisWidth={effectiveTimelineWidth}
                  frameToX={frameToX}
                  getRenderedKeyframeX={getRenderedKeyframeX}
                  selectedKeyframeIds={selectedKeyframeIds}
                  disabled={disabled}
                  isPropertyLocked={isPropertyLocked}
                  onGroupKeyframePointerDown={handleGroupKeyframePointerDown}
                  onBackgroundPointerDown={handleTimelineBackgroundPointerDown}
                  sheetPreviewFrames={sheetPreviewFrames}
                  sheetPreviewDuplicateKeyframeIds={sheetPreviewDuplicateKeyframeIds}
                />
              </TimelineViewportCuller>
            </div>
          )
        }

        const { row } = entry
        const rowLocked = isPropertyLocked(row.property)
        return (
          <div
            key={row.property}
            className="grid border-b border-border/60"
            style={propertyTimelineRowStyle}
          >
            {sheetPropertyContentByProperty.get(row.property)}
            <TimelineViewportCuller>
              <PropertyTimelineCell
                itemId={itemId}
                property={row.property}
                keyframes={rowKeyframesByProperty.get(row.property) ?? EMPTY_KEYFRAMES}
                locked={rowLocked}
                ticks={ticks}
                axisWidth={effectiveTimelineWidth}
                frameToX={frameToX}
                getRenderedKeyframeX={getRenderedKeyframeX}
                renderedKeyframeXById={renderedKeyframeXById}
                transitionBlockedRanges={transitionBlockedRanges}
                proceduralBand={proceduralBandByProperty.get(row.property)}
                selectedKeyframeIds={selectedKeyframeIds}
                disabled={disabled}
                onRowPointerDown={handleRowPointerDown}
                onKeyframePointerDown={handleKeyframePointerDown}
                onSegmentEasingChange={onSegmentEasingChange}
                onSegmentDragStart={onDragStart}
                onSegmentDragEnd={onDragEnd}
                setKeyframeButtonRef={setKeyframeButtonRef}
                keyframeMetaByIdRef={keyframeMetaByIdRef}
                sheetPreviewFrames={sheetPreviewFrames}
                sheetPreviewDuplicateKeyframeIds={sheetPreviewDuplicateKeyframeIds}
              />
            </TimelineViewportCuller>
          </div>
        )
      }),
    [
      renderedSheetEntries.entries,
      expandedGroups,
      groupTimelineRowStyle,
      propertyTimelineRowStyle,
      groupTimelineById,
      rowKeyframesByProperty,
      handleRowPointerDown,
      handleTimelineBackgroundPointerDown,
      handleGroupKeyframePointerDown,
      sheetGroupContentById,
      sheetPropertyContentByProperty,
      getRenderedKeyframeX,
      isPropertyLocked,
      disabled,
      ticks,
      effectiveTimelineWidth,
      frameToX,
      transitionBlockedRanges,
      proceduralBandByProperty,
      renderedKeyframeXById,
      selectedKeyframeIds,
      sheetPreviewDuplicateKeyframeIds,
      sheetPreviewFrames,
      handleKeyframePointerDown,
      setKeyframeButtonRef,
      keyframeMetaByIdRef,
      itemId,
      onSegmentEasingChange,
      onDragStart,
      onDragEnd,
    ],
  )
  const propertyColumnElements = useMemo(
    () =>
      groupedPropertyRows.flatMap<React.ReactNode>((group): React.ReactNode[] => {
        const inline = inlinePropertyGroupIdSet.has(group.id)
        const propertyElements = group.rows.map((row) => (
          <div
            key={row.property}
            className="border-b border-border/60"
            style={{ height: ROW_HEIGHT }}
          >
            {renderPropertyRowContent(row, { indented: !inline })}
          </div>
        ))
        if (inline) {
          return propertyElements
        }

        const groupOpen = expandedGroups[group.id] ?? true
        const elements: React.ReactNode[] = [
          <div
            key={group.id}
            className="border-b border-border/60"
            style={{ height: GROUP_HEADER_HEIGHT }}
          >
            {renderGroupHeaderContent(group)}
          </div>,
        ]

        if (!groupOpen) {
          return elements
        }

        return elements.concat(propertyElements)
      }),
    [
      expandedGroups,
      groupedPropertyRows,
      inlinePropertyGroupIdSet,
      renderGroupHeaderContent,
      renderPropertyRowContent,
    ],
  )
  const emptyStateMessage = hasPropertyFilters
    ? t('timeline.keyframeEditor.noParametersMatch')
    : t('timeline.keyframeEditor.noKeyframesToDisplay')
  const showEmptyGuidance = !hasPropertyFilters
  // A clip can be animated by procedural modulators / audio pulse yet have no
  // keyframes — the sheet would otherwise look empty and "unanimated".
  const hasProceduralMotion = useItemsStore((s) => {
    const target = s.itemById[itemId]
    if (!target) return false
    return (
      (target.motionModifiers?.some((modifier) => modifier.enabled) ?? false) ||
      (target.effects?.some((effect) => effect.audioPulse?.enabled) ?? false)
    )
  })
  const proceduralHint =
    showEmptyGuidance && hasProceduralMotion
      ? t('timeline.keyframeEditor.proceduralMotionHint')
      : undefined

  // Hoisted so the graph pane and sheet body can be composed once and reused
  // across the exclusive (`graph`/`dopesheet`) and the `split` placements.
  const rulerHeaderElement = (
    <DopesheetRulerHeader
      propertyGridStyle={propertyGridStyle}
      timelineRef={timelineRef}
      onRulerPointerDown={handleRulerPointerDown}
      onRulerPointerMove={handleRulerPointerMove}
      onRulerPointerUp={handleRulerPointerUp}
      rulerTickElements={rulerTickElements}
    />
  )
  // The timeline cells (ruler, rows, graph) all sit behind a 1px `border-l`, so
  // their content origin is `columnWidth + 1`. The playhead overlay isn't inside
  // those cells, so it must add that 1px to line up with ticks, keyframes and the
  // ruler flag.
  const timelineContentLeft = columnWidth + 1
  const playheadOverlayElement = showPlayhead ? (
    <div
      data-testid="dopesheet-playhead-clip"
      className="absolute top-0 bottom-0 right-0 overflow-hidden pointer-events-none z-20"
      style={{ left: timelineContentLeft }}
    >
      <DopesheetPlayheadLine
        relativeFrame={currentFrame}
        itemFrom={itemFrom}
        totalFrames={totalFrames}
        frameToX={frameToX}
        maxLeft={effectiveTimelineWidth - 1}
        className="absolute top-0 bottom-0"
      />
    </div>
  ) : null
  // Split view: one playhead element spans the ruler, sheet, and graph panes.
  // The graph's own line is hidden via `hidePlayhead`.
  const splitPlayheadOverlayElement = showPlayhead ? (
    <div
      data-testid="dopesheet-playhead-clip"
      className="absolute top-0 right-0 bottom-0 overflow-hidden pointer-events-none z-30"
      style={{ left: timelineContentLeft }}
    >
      <DopesheetPlayheadLine
        relativeFrame={currentFrame}
        itemFrom={itemFrom}
        totalFrames={totalFrames}
        frameToX={frameToX}
        maxLeft={effectiveTimelineWidth - 1}
        className="absolute top-0 bottom-0"
      />
    </div>
  ) : null
  const sheetBodyElement = (
    <DopesheetSheetBody
      scrollAreaRef={scrollAreaRef}
      hasRows={sheetRows.length > 0}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      proceduralHint={proceduralHint}
      rowElements={rowElements}
      marqueeOverlayRef={marqueeOverlayRef}
      propertyColumnWidth={columnWidth}
      subtractRulerHeight={presentation !== 'lanes'}
      onTimelineBackgroundPointerDown={handleTimelineBackgroundPointerDown}
    />
  )
  const graphPaneElement = (
    <DopesheetGraphPane
      hasRows={propertyRows.length > 0}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      proceduralHint={proceduralHint}
      propertyColumnElements={propertyColumnElements}
      propertyColumnWidth={columnWidth}
      graphPaneRef={graphPaneRef}
      disabled={disabled}
      graphDisplayPropertyLocked={graphDisplayPropertyLocked}
      focusGraphPane={focusGraphPane}
      handleGraphPaneKeyDown={handleGraphPaneKeyDown}
      graphPaneSize={graphPaneSize}
      graphVisiblePropertiesSize={visibleGraphProperties.length}
      viewport={viewport}
      updateViewport={updateViewport}
      itemId={itemId}
      keyframesByProperty={keyframesByProperty}
      graphDisplayProperty={graphDisplayProperty}
      graphVisibleProperties={
        singleCurveMode && graphDisplayProperty
          ? [
              graphDisplayProperty,
              ...(compoundSecondaryProperties[graphDisplayProperty]
                ? [compoundSecondaryProperties[graphDisplayProperty]!]
                : []),
            ]
          : visibleGraphProperties
      }
      selectedKeyframeIds={selectedKeyframeIds}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      fps={fps}
      onKeyframeMove={onKeyframeMove}
      timingStripPreviewFrames={timingStripPreviewFrames}
      constrainGraphFrameDelta={constrainGraphFrameDelta}
      onBezierHandleMove={onBezierHandleMove}
      onSelectionChange={onSelectionChange}
      onPropertyChange={onPropertyChange}
      onScrub={onScrub}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onAddKeyframe={onAddKeyframe}
      onRemoveKeyframes={onRemoveKeyframes}
      onNavigateToKeyframe={onNavigateToKeyframe}
      transitionBlockedRanges={transitionBlockedRanges}
      proceduralPreview={proceduralPreview}
      snapEnabled={snapEnabled}
      graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
      graphRulerUnit={graphRulerUnit}
      autoZoomGraphHeight={autoZoomGraphHeight}
      graphVerticalZoomValue={graphVerticalZoomValue}
      hidePlayhead={!showPlayhead || isSplitView}
      subtractRulerHeight={presentation !== 'lanes'}
      customGraphContent={graphMode === 'speed' ? speedGraphContent : undefined}
    />
  )

  if (presentation === 'lanes') {
    return (
      <div
        ref={pickWhipRootRef}
        className={cn(
          'relative overflow-hidden',
          disabled && 'opacity-60 pointer-events-none',
          className,
        )}
        style={{ height, width }}
        onWheel={handleWheel}
        onKeyDown={handleGraphPaneKeyDown}
      >
        <div
          ref={timelineRef}
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{ left: columnWidth }}
        />
        {showGraphPane ? graphPaneElement : sheetBodyElement}
        {showSheetPane ? playheadOverlayElement : null}
        {expressionReferenceDrag ? (
          <PickWhipOverlay
            drag={{
              ...expressionReferenceDrag,
              valid: Boolean(expressionReferenceDrag.candidate),
            }}
            testId="expression-reference-pick-whip"
          />
        ) : null}
      </div>
    )
  }

  return (
    <div
      ref={pickWhipRootRef}
      className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)}
      style={{ height, width }}
    >
      <div className="flex items-center justify-between px-2 flex-shrink-0 min-h-7">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {t('timeline.keyframeEditor.parameters')}
            </span>
            <DopesheetParameterMenu
              disabled={disabled}
              hasAvailableProperties={availableProperties.length > 0}
              parameterFilter={filterKeyframedOnly ? 'keyframed' : 'all'}
              onToggleKeyframedOnly={() => setShowKeyframedOnly((prev) => !prev)}
              allPropertyGroups={allPropertyGroups}
              visibleGroups={visibleGroups}
              onToggleVisibleGroup={toggleVisibleGroup}
              onExpandAll={() => setAllGroupsExpanded(true)}
              onCollapseAll={() => setAllGroupsExpanded(false)}
              onResetParameterView={resetParameterView}
            />
          </div>

          {hasPropertyFilters && (
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {t('timeline.keyframeEditor.filtered')}
            </span>
          )}

          {showGraphPane && graphDisplayProperty && (
            <span className="text-xs text-muted-foreground">
              {t('timeline.keyframeEditor.graphLabel', {
                property:
                  compoundPropertyRows[graphDisplayProperty]?.label ??
                  getKeyframePropertyLabel(t, graphDisplayProperty),
              })}
            </span>
          )}

          {showGraphPane && speedGraphContent && onGraphModeChange && (
            <div
              className="flex h-6 items-center rounded border border-border/70 bg-background/80 p-0.5"
              role="group"
              aria-label={t('timeline.keyframeEditor.graphType', {
                defaultValue: 'Graph type',
              })}
            >
              {(['value', 'speed'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    'h-5 rounded px-2 text-[10px] font-medium text-muted-foreground active:scale-[0.97]',
                    graphMode === mode && 'bg-muted text-foreground',
                  )}
                  aria-pressed={graphMode === mode}
                  onClick={() => onGraphModeChange(mode)}
                >
                  {mode === 'value'
                    ? t('timeline.keyframeEditor.valueGraph', { defaultValue: 'Value' })
                    : t('timeline.keyframeEditor.speedGraph', { defaultValue: 'Speed' })}
                </button>
              ))}
            </div>
          )}

          <span className="text-xs text-muted-foreground">
            {t('timeline.keyframeEditor.keyframes', {
              count: visibleKeyframes.length,
            })}
          </span>

          {isCurrentFrameBlocked && (
            <span
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
              title={t('timeline.keyframeEditor.transitionBlocked')}
            >
              {t('timeline.keyframeEditor.transitionBlockedPill')}
            </span>
          )}

          {canBakeMotion && onBakeMotion && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-sky-300 hover:text-sky-200"
              onClick={onBakeMotion}
              title={t('timeline.keyframeEditor.bakeMotionHint')}
            >
              <Sparkles className="h-3 w-3" />
              {t('timeline.keyframeEditor.bakeMotion')}
            </Button>
          )}

          <DopesheetHeaderFrameInputs
            disabled={disabled}
            inputsEnabled={
              Boolean(onKeyframeMove) &&
              selectedFrameSummary.hasSelection &&
              !selectedFrameSummary.hasMixedFrames
            }
            totalFrames={totalFrames}
            globalFrame={globalFrame}
            localFrameInputValue={localFrameInputValue}
            globalFrameInputValue={globalFrameInputValue}
            setLocalFrameInputValue={setLocalFrameInputValue}
            setGlobalFrameInputValue={setGlobalFrameInputValue}
            skipNextHeaderFrameBlurRef={skipNextHeaderFrameBlurRef}
            commitLocalFrameInput={commitLocalFrameInput}
            commitGlobalFrameInput={commitGlobalFrameInput}
            handleHeaderFrameInputKeyDown={handleHeaderFrameInputKeyDown}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <DopesheetInterpolationButtons
            options={interpolationOptions}
            selected={selectedInterpolation}
            disabled={disabled || interpolationDisabled}
            onSelect={onInterpolationChange}
          />
          <DopesheetClipboardActions
            disabled={disabled}
            hasSelection={selectedRefs.length > 0}
            hasKeyframeClipboard={hasKeyframeClipboard}
            isKeyframeClipboardCut={isKeyframeClipboardCut}
            onCopyKeyframes={onCopyKeyframes}
            onCutKeyframes={onCutKeyframes}
            onPasteKeyframes={onPasteKeyframes}
          />
          <DopesheetEditActions
            disabled={disabled}
            hasSelection={selectedRefs.length > 0}
            removeKeyframesAvailable={Boolean(onRemoveKeyframes)}
            handleRemoveKeyframes={handleRemoveKeyframes}
            horizontalZoomValue={horizontalZoomValue}
            horizontalZoomDisabled={horizontalZoomRatioBase <= 1}
            setHorizontalZoomValue={setHorizontalZoomValue}
            resetViewport={resetViewport}
            visualizationMode={showGraphPane ? 'graph' : 'dopesheet'}
            graphVerticalZoomValue={graphVerticalZoomValue}
            verticalZoomDisabled={visibleGraphProperties.length === 0 || verticalZoomRatioBase <= 1}
            setGraphVerticalZoomValue={setGraphVerticalZoomValue}
          />
          <DopesheetLegendPopover disabled={disabled} />
          <DopesheetViewOptionsMenu
            disabled={disabled}
            visualizationMode={showGraphPane ? 'graph' : 'dopesheet'}
            graphRulerUnit={graphRulerUnit}
            onChangeRulerUnit={setGraphRulerUnit}
            graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
            onToggleGraphHandleVisibility={() => setShowAllGraphHandles((prev) => !prev)}
            autoZoomGraphHeight={autoZoomGraphHeight}
            onToggleAutoZoomGraphHeight={() => setAutoZoomGraphHeight((prev) => !prev)}
          />
        </div>
      </div>

      <div
        className={cn(
          'border border-border rounded-md flex-1 min-h-0 overflow-hidden relative',
          disabled && 'opacity-60 pointer-events-none',
          isSplitView && 'flex flex-col',
        )}
        onWheel={visualizationMode === 'dopesheet' ? handleWheel : undefined}
      >
        {isSplitView ? (
          <>
            {rulerHeaderElement}
            {/* Sheet on top, curve/graph below, with ONE shared playhead line
                ({splitPlayheadOverlayElement}) drawn over both panes so they
                stay identical in position and appearance. */}
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              role="region"
              aria-label={t('timeline.keyframeEditor.sheet')}
              onWheel={handleWheel}
            >
              {sheetBodyElement}
            </div>
            <div
              className="min-h-0 flex-1 overflow-hidden border-t border-border/60"
              role="region"
              aria-label={t('timeline.keyframeEditor.graph')}
            >
              {graphPaneElement}
            </div>
            {splitPlayheadOverlayElement}
          </>
        ) : (
          <>
            {/* Sheet mode only: the graph renders its own aligned playhead
                (GraphPlayhead) using the graph's coordinate space. */}
            {showSheetPane && playheadOverlayElement}
            {rulerHeaderElement}
            {showGraphPane ? graphPaneElement : sheetBodyElement}
          </>
        )}
      </div>
      {showGraphPane && (
        <div className="grid" style={propertyGridStyle}>
          <div className="h-4 border-t border-r border-border/60 bg-background/80" />
          <div data-testid="keyframe-timing-strip-viewport-column">
            <KeyframeTimingStrip
              viewport={viewport}
              contentFrameMax={contentFrameMax}
              markers={timingStripMarkers}
              previewFrames={timingStripPreviewFrames}
              disabled={disabled || timingStripMarkers.length === 0}
              onSelectionChange={handleTimingStripSelectionChange}
              onSlideStart={handleTimingStripSlideStart}
              onSlideChange={handleTimingStripSlideChange}
              onSlideEnd={handleTimingStripSlideEnd}
            />
          </div>
        </div>
      )}
      <div className="grid" style={propertyGridStyle}>
        <div
          data-testid="keyframe-navigator-property-column"
          className="h-5 border-t border-r border-border/60 bg-background/80"
        />
        <div data-testid="keyframe-navigator-viewport-column">
          <CompactNavigator
            viewport={viewport}
            currentFrame={currentFrame}
            contentFrameMax={contentFrameMax}
            minVisibleFrames={minViewportFrames}
            disabled={disabled}
            onViewportChange={updateViewport}
          />
        </div>
      </div>
      {expressionReferenceDrag ? (
        <PickWhipOverlay
          drag={{ ...expressionReferenceDrag, valid: Boolean(expressionReferenceDrag.candidate) }}
          testId="expression-reference-pick-whip"
        />
      ) : null}
    </div>
  )
})
