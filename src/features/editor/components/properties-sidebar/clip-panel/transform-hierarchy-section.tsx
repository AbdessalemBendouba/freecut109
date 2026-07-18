import { useMemo } from 'react'
import { Crosshair, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { useThrottledFrame } from '@/features/editor/deps/preview'
import {
  createNullParentForItems,
  setTransformParents,
} from '@/features/editor/deps/timeline-motion'
import { useSelectionStore } from '@/shared/state/selection'
import { wouldCreateTransformParentCycle } from '@/shared/utils/transform-parenting'
import { PropertyRow, PropertySection } from '../components'

const NO_PARENT = '__none__'
const MIXED_PARENT = '__mixed__'

function canParticipate(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'adjustment'
}

function getParentCandidates(
  hierarchyItems: TimelineItem[],
  allItems: TimelineItem[],
  itemById: Map<string, TimelineItem>,
): TimelineItem[] {
  const selectedItemIds = new Set(hierarchyItems.map((item) => item.id))
  return allItems
    .filter(
      (candidate) =>
        !selectedItemIds.has(candidate.id) &&
        canParticipate(candidate) &&
        hierarchyItems.every(
          (item) =>
            !wouldCreateTransformParentCycle(item.id, candidate.id, (id) => itemById.get(id)),
        ),
    )
    .toSorted((left, right) => {
      const controllerOrder =
        Number(right.type === 'controller') - Number(left.type === 'controller')
      return controllerOrder || left.label.localeCompare(right.label)
    })
}

function ParentingHint({
  hasMixedParents,
  parent,
  selectionCount,
}: {
  hasMixedParents: boolean
  parent?: TimelineItem
  selectionCount: number
}) {
  const { t } = useTranslation()
  let hint: string

  if (hasMixedParents) {
    hint = t('editor.transformHierarchy.mixedHint', {
      defaultValue: '{{count}} layers have different parents. Choose one to rig them together.',
      count: selectionCount,
    })
  } else if (parent && selectionCount > 1) {
    hint = t('editor.transformHierarchy.multiAttachedHint', {
      defaultValue: '{{count}} layers follow {{name}} for position, scale, and rotation.',
      count: selectionCount,
      name: parent.label,
    })
  } else if (parent) {
    hint = t('editor.transformHierarchy.attachedHint', {
      defaultValue: 'Follows {{name}} for position, scale, and rotation.',
      name: parent.label,
    })
  } else if (selectionCount > 1) {
    hint = t('editor.transformHierarchy.multiDetachedHint', {
      defaultValue:
        'Choose a Null Object or layer to move, scale, and rotate {{count}} layers together.',
      count: selectionCount,
    })
  } else {
    hint = t('editor.transformHierarchy.detachedHint', {
      defaultValue: 'Choose a Null Object or layer to move, scale, and rotate them together.',
    })
  }

  return <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
}

export function TransformHierarchySection({
  items,
  allItems,
  canvas,
  showUnparented = false,
  allowCreateNullParent = false,
}: {
  items: TimelineItem[]
  allItems: TimelineItem[]
  canvas: CanvasSettings
  /** Motion teaches parenting up front; Edit only surfaces an existing relationship. */
  showUnparented?: boolean
  /** Contextual rig creation belongs to Motion, never the ordinary Edit inspector. */
  allowCreateNullParent?: boolean
}) {
  const { t } = useTranslation()
  const frame = useThrottledFrame()
  const selectItems = useSelectionStore((state) => state.selectItems)
  const hierarchyItems = useMemo(
    () => (items.length > 0 && items.every(canParticipate) ? items : []),
    [items],
  )
  const itemById = useMemo(
    () => new Map(allItems.map((candidate) => [candidate.id, candidate])),
    [allItems],
  )
  const candidates = useMemo(
    () => getParentCandidates(hierarchyItems, allItems, itemById),
    [allItems, hierarchyItems, itemById],
  )

  if (hierarchyItems.length === 0) return null
  const parentValues = new Set(
    hierarchyItems.map((item) => item.transformParent?.parentItemId ?? NO_PARENT),
  )
  const hasMixedParents = parentValues.size > 1
  const selectedParentValue = hasMixedParents ? MIXED_PARENT : ([...parentValues][0] ?? NO_PARENT)
  const parentId =
    !hasMixedParents && selectedParentValue !== NO_PARENT ? selectedParentValue : undefined
  const parent = parentId ? itemById.get(parentId) : undefined
  const hasAnyParent = hierarchyItems.some((item) => item.transformParent?.parentItemId)
  if (!showUnparented && !hasAnyParent) return null
  const childItemIds = hierarchyItems.map((item) => item.id)
  const selectionCount = hierarchyItems.length

  return (
    <PropertySection
      title={t('editor.transformHierarchy.title', { defaultValue: 'Parenting' })}
      icon={GitBranch}
      defaultOpen
    >
      <PropertyRow label={t('editor.transformHierarchy.parent', { defaultValue: 'Parent' })}>
        <Select
          value={selectedParentValue}
          onValueChange={(value) => {
            const nextParentId = value === NO_PARENT ? undefined : value
            if (!hasMixedParents && nextParentId === parentId) return
            setTransformParents({ childItemIds, parentItemId: nextParentId, frame, canvas })
          }}
        >
          <SelectTrigger
            className="h-7 min-w-0 text-xs"
            aria-label={t('editor.transformHierarchy.parent', { defaultValue: 'Parent' })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hasMixedParents && (
              <SelectItem value={MIXED_PARENT} disabled className="text-xs">
                {t('editor.transformHierarchy.mixed', { defaultValue: 'Mixed parents' })}
              </SelectItem>
            )}
            <SelectItem value={NO_PARENT} className="text-xs">
              {t('editor.transformHierarchy.none', { defaultValue: 'None' })}
            </SelectItem>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id} className="text-xs">
                {candidate.type === 'controller'
                  ? t('editor.transformHierarchy.controllerOption', {
                      defaultValue: 'Null: {{name}}',
                      name: candidate.label,
                    })
                  : candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>
      <ParentingHint
        hasMixedParents={hasMixedParents}
        parent={parent}
        selectionCount={selectionCount}
      />
      {allowCreateNullParent && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full gap-1.5 text-xs"
          onClick={() => {
            const nullParent = createNullParentForItems({ childItemIds, frame, canvas })
            if (nullParent) selectItems([nullParent.id])
          }}
        >
          <Crosshair className="h-3.5 w-3.5" />
          {t('editor.transformHierarchy.parentToNewNull', {
            defaultValue: 'Parent selection to new Null',
          })}
        </Button>
      )}
    </PropertySection>
  )
}
