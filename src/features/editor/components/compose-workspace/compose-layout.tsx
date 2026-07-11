import { memo, useEffect, useMemo, useRef } from 'react'
import { ErrorBoundary } from '@/app/error-boundary'
import {
  getActiveTabId,
  useCompositionNavigationStore,
  useCompositionsStore,
} from '@/features/editor/deps/timeline-contract'
import { useEditorStore } from '@/shared/state/editor'
import { PreviewArea } from '../preview-area'
import { CompositingTimeline } from './compositing-timeline'

interface MotionWorkspaceProject {
  width: number
  height: number
  fps: number
}

/**
 * Shared preview adapter for Motion. The preview surface stays the same; only
 * its canvas settings follow the active 2D composition.
 */
export const MotionPreviewArea = memo(function MotionPreviewArea({
  project,
}: {
  project: MotionWorkspaceProject
}) {
  const activeCompositionId = useCompositionNavigationStore((state) => state.activeCompositionId)
  const activeComposition = useCompositionsStore((state) =>
    activeCompositionId ? state.compositionById[activeCompositionId] : undefined,
  )
  const previewProject = useMemo(
    () =>
      activeComposition?.editorKind === 'composite-2d'
        ? {
            width: activeComposition.width,
            height: activeComposition.height,
            fps: activeComposition.fps,
          }
        : project,
    [activeComposition, project],
  )

  return <PreviewArea project={previewProject} />
})

/**
 * Motion owns only the bottom dock. It captures the outgoing editorial tab so
 * Edit, Color, and Animate return to the exact sequence the user left.
 */
export const MotionTimelineDock = memo(function MotionTimelineDock({
  project,
}: {
  project: MotionWorkspaceProject
}) {
  const returnTabIdRef = useRef(
    getActiveTabId(useCompositionNavigationStore.getState().breadcrumbs),
  )

  useEffect(
    () => () => {
      if (useEditorStore.getState().workspace === 'motion') return
      useCompositionNavigationStore.getState().switchToSequence(returnTabIdRef.current)
    },
    [],
  )

  return (
    <ErrorBoundary level="feature">
      <CompositingTimeline className="h-full" defaults={project} />
    </ErrorBoundary>
  )
})
