import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { LinkableAnimatableProperty } from '@/types/keyframe'
import { isLinkableAnimatableProperty } from '@/types/keyframe'
import {
  removeLinkedPropertyExpression,
  setLinkedPropertyExpression,
  useKeyframesStore,
  wouldCreateLinkedPropertyCycle,
} from '@/features/editor/deps/timeline-motion'

interface LinkedExpressionDragState {
  pointerId: number
  targetItemId: string
  targetProperty: LinkableAnimatableProperty
  startX: number
  startY: number
  currentX: number
  currentY: number
  moved: boolean
  sourceItemId: string | null
  sourceProperty: LinkableAnimatableProperty | null
}

interface LinkedExpressionCandidate {
  row: HTMLElement
  itemId: string
  property: LinkableAnimatableProperty
}

function resolveCandidate(clientX: number, clientY: number): LinkedExpressionCandidate | null {
  const element = document.elementFromPoint(clientX, clientY)
  const row = element?.closest<HTMLElement>('[data-expression-item-id][data-expression-property]')
  const itemId = row?.dataset.expressionItemId
  const property = row?.dataset.expressionProperty
  if (!row || !itemId || !property || !isLinkableAnimatableProperty(property)) return null
  return { row, itemId, property }
}

function rejectOrigin(
  candidate: LinkedExpressionCandidate | null,
  current: LinkedExpressionDragState,
): LinkedExpressionCandidate | null {
  const isOrigin =
    candidate?.itemId === current.targetItemId && candidate.property === current.targetProperty
  return isOrigin ? null : candidate
}

function updateHover(
  hoverRef: MutableRefObject<HTMLElement | null>,
  row: HTMLElement | null,
): void {
  if (hoverRef.current === row) return
  hoverRef.current?.removeAttribute('data-expression-link-hover')
  if (row) row.setAttribute('data-expression-link-hover', 'true')
  hoverRef.current = row
}

function commitLink(current: LinkedExpressionDragState, onCycle: () => void): void {
  if (!current.sourceItemId || !current.sourceProperty) return
  const keyframesByItemId = useKeyframesStore.getState().keyframesByItemId
  const createsCycle = wouldCreateLinkedPropertyCycle(
    current.targetItemId,
    current.targetProperty,
    current.sourceItemId,
    current.sourceProperty,
    (itemId) => keyframesByItemId[itemId],
  )
  if (createsCycle) {
    onCycle()
    return
  }
  setLinkedPropertyExpression(current.targetItemId, {
    type: 'link',
    targetProperty: current.targetProperty,
    sourceItemId: current.sourceItemId,
    sourceProperty: current.sourceProperty,
    enabled: true,
    timeOffsetFrames: 0,
  })
}

function createNextDragState(
  current: LinkedExpressionDragState,
  event: PointerEvent,
  candidate: LinkedExpressionCandidate | null,
): LinkedExpressionDragState {
  return {
    ...current,
    currentX: event.clientX,
    currentY: event.clientY,
    moved:
      current.moved ||
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 3,
    sourceItemId: candidate?.itemId ?? null,
    sourceProperty: candidate?.property ?? null,
  }
}

export function useLinkedTransformPickWhip() {
  const { t } = useTranslation()
  const [drag, setDrag] = useState<LinkedExpressionDragState | null>(null)
  const dragRef = useRef<LinkedExpressionDragState | null>(null)
  const hoverRef = useRef<HTMLElement | null>(null)

  const begin = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      itemId: string,
      property: LinkableAnimatableProperty,
    ) => {
      if (event.button !== 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      const next: LinkedExpressionDragState = {
        pointerId: event.pointerId,
        targetItemId: itemId,
        targetProperty: property,
        startX: rect.left + rect.width / 2,
        startY: rect.top + rect.height / 2,
        currentX: event.clientX,
        currentY: event.clientY,
        moved: false,
        sourceItemId: null,
        sourceProperty: null,
      }
      dragRef.current = next
      setDrag(next)
    },
    [],
  )

  const remove = useCallback((itemId: string, property: LinkableAnimatableProperty) => {
    removeLinkedPropertyExpression(itemId, property)
  }, [])

  useEffect(() => {
    const clear = () => updateHover(hoverRef, null)
    const move = (event: PointerEvent) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) return
      const candidate = rejectOrigin(resolveCandidate(event.clientX, event.clientY), current)
      updateHover(hoverRef, candidate?.row ?? null)
      const next = createNextDragState(current, event, candidate)
      dragRef.current = next
      setDrag(next)
    }
    const finish = (event: PointerEvent, commit: boolean) => {
      const current = dragRef.current
      if (!current || current.pointerId !== event.pointerId) return
      clear()
      dragRef.current = null
      setDrag(null)
      if (!commit || !current.moved) return
      commitLink(current, () => toast.error(t('editor.compose.propertyLinkCycle')))
    }
    const pointerUp = (event: PointerEvent) => finish(event, true)
    const pointerCancel = (event: PointerEvent) => finish(event, false)
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return
      clear()
      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('keydown', keyDown)
    return () => {
      clear()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('keydown', keyDown)
    }
  }, [t])

  return { drag, begin, remove }
}
