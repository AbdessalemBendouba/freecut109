import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import type { CanvasSettings, TransformParentingBehavior } from '@/types/transform'
import {
  setTransformParents,
  useItemsStore,
} from '@/features/editor/deps/timeline-motion'
import { wouldCreateTransformParentCycle } from '@/shared/utils/transform-parenting'
import {
  useMotionPickWhipDrag,
  type MotionPickWhipModifiers,
} from '@/shared/hooks/use-pick-whip-drag'

interface ParentOrigin {
  childItemId: string
}

interface ParentCandidate {
  parentItemId: string
}

function resolveParentCandidate(clientX: number, clientY: number, origin: ParentOrigin) {
  const element = document.elementFromPoint(clientX, clientY)
  const row = element?.closest<HTMLElement>('[data-motion-layer-item-id]')
  const parentItemId = row?.dataset.motionLayerItemId
  if (!row || !parentItemId || parentItemId === origin.childItemId) return null
  const itemById = useItemsStore.getState().itemById
  const parent = itemById[parentItemId]
  if (!parent || parent.type === 'audio' || parent.type === 'adjustment') return null
  if (
    wouldCreateTransformParentCycle(
      origin.childItemId,
      parentItemId,
      (itemId) => itemById[itemId],
    )
  ) {
    return null
  }
  return { row, value: { parentItemId } }
}

function getParentingBehavior(
  modifiers: Pick<MotionPickWhipModifiers, 'shiftKey' | 'altKey'>,
): TransformParentingBehavior {
  if (modifiers.shiftKey) return 'snap-to-parent'
  if (modifiers.altKey) return 'restore-local'
  return 'preserve-world'
}

export function useTransformParentPickWhip(canvas: CanvasSettings) {
  const applyParent = useCallback(
    (
      childItemId: string,
      parentItemId: string | undefined,
      behavior: TransformParentingBehavior,
    ) => {
      const playback = usePlaybackStore.getState()
      setTransformParents({
        childItemIds: [childItemId],
        parentItemId,
        behavior,
        frame: playback.previewFrame ?? playback.currentFrame,
        canvas,
      })
    },
    [canvas],
  )
  const commit = useCallback(
    (origin: ParentOrigin, candidate: ParentCandidate, modifiers: MotionPickWhipModifiers) => {
      applyParent(
        origin.childItemId,
        candidate.parentItemId,
        getParentingBehavior(modifiers),
      )
    },
    [applyParent],
  )
  const { drag: genericDrag, begin: beginDrag } = useMotionPickWhipDrag({
    hoverAttribute: 'data-transform-parent-link-hover',
    resolveCandidate: resolveParentCandidate,
    onCommit: commit,
  })

  const begin = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      childItemId: string,
      currentParentItemId: string | undefined,
    ) => {
      if (event.button !== 0) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        if (currentParentItemId) {
          applyParent(
            childItemId,
            undefined,
            event.altKey ? 'restore-local' : 'preserve-world',
          )
        }
        return
      }
      beginDrag(event, { childItemId })
    },
    [applyParent, beginDrag],
  )
  const drag = genericDrag
    ? {
        startX: genericDrag.startX,
        startY: genericDrag.startY,
        currentX: genericDrag.currentX,
        currentY: genericDrag.currentY,
        sourceItemId: genericDrag.candidate?.value.parentItemId ?? null,
        clipBounds: genericDrag.clipBounds,
        presentation: genericDrag.presentation,
      }
    : null

  return { drag, begin }
}
