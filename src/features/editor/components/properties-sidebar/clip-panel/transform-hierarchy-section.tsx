import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { setTransformParent } from '@/features/editor/deps/timeline-motion'
import { wouldCreateTransformParentCycle } from '@/shared/utils/transform-parenting'
import { PropertyRow, PropertySection } from '../components'

const NO_PARENT = '__none__'

function canParticipate(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'adjustment'
}

export function TransformHierarchySection({
  items,
  allItems,
  canvas,
}: {
  items: TimelineItem[]
  allItems: TimelineItem[]
  canvas: CanvasSettings
}) {
  const { t } = useTranslation()
  const frame = useThrottledFrame()
  const item = items.length === 1 && items[0] && canParticipate(items[0]) ? items[0] : null
  const itemById = useMemo(
    () => new Map(allItems.map((candidate) => [candidate.id, candidate])),
    [allItems],
  )
  const candidates = useMemo(() => {
    if (!item) return []
    return allItems
      .filter(
        (candidate) =>
          candidate.id !== item.id &&
          canParticipate(candidate) &&
          !wouldCreateTransformParentCycle(item.id, candidate.id, (id) => itemById.get(id)),
      )
      .toSorted((left, right) => {
        const controllerOrder = Number(right.type === 'controller') - Number(left.type === 'controller')
        return controllerOrder || left.label.localeCompare(right.label)
      })
  }, [allItems, item, itemById])

  if (!item) return null
  const parentId = item.transformParent?.parentItemId
  const parent = parentId ? itemById.get(parentId) : undefined

  return (
    <PropertySection
      title={t('editor.transformHierarchy.title', { defaultValue: 'Hierarchy' })}
      icon={GitBranch}
      defaultOpen
    >
      <PropertyRow label={t('editor.transformHierarchy.parent', { defaultValue: 'Parent' })}>
        <Select
          value={parent?.id ?? NO_PARENT}
          onValueChange={(value) => {
            const nextParentId = value === NO_PARENT ? undefined : value
            if (nextParentId === parent?.id) return
            setTransformParent({ childItemId: item.id, parentItemId: nextParentId, frame, canvas })
          }}
        >
          <SelectTrigger
            className="h-7 min-w-0 text-xs"
            aria-label={t('editor.transformHierarchy.parent', { defaultValue: 'Parent' })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PARENT} className="text-xs">
              {t('editor.transformHierarchy.none', { defaultValue: 'None' })}
            </SelectItem>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id} className="text-xs">
                {candidate.type === 'controller'
                  ? t('editor.transformHierarchy.controllerOption', {
                      defaultValue: 'Controller · {{name}}',
                      name: candidate.label,
                    })
                  : candidate.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PropertyRow>
      <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">
        {parent
          ? t('editor.transformHierarchy.attachedHint', {
              defaultValue: 'Inherits position, scale, and rotation from {{name}}.',
              name: parent.label,
            })
          : t('editor.transformHierarchy.detachedHint', {
              defaultValue: 'Attach to a controller or layer without changing the current pose.',
            })}
      </p>
    </PropertySection>
  )
}
