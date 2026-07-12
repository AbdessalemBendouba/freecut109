import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Spline } from 'lucide-react'
import { ErrorBoundary } from '@/app/error-boundary'
import { Button } from '@/components/ui/button'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  getActiveTabId,
  useCompositionNavigationStore,
  useCompositionsStore,
} from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { PreviewArea } from '../preview-area'
import { CompositingTimeline } from './compositing-timeline'
import { NewCompositionDialog } from './new-composition-dialog'
import { useComposeUiStore } from './compose-ui-store'

interface MotionWorkspaceProject {
  width: number
  height: number
  fps: number
}

function restoreMotionReturnTimeline(): void {
  const composeUi = useComposeUiStore.getState()
  if (!composeUi.motionReturnTabCaptured) return
  const returnTabId = composeUi.motionReturnTabId
  // Clear first so navigation-triggered store updates cannot re-enter this path.
  composeUi.clearMotionReturnTab()
  useCompositionNavigationStore.getState().switchToSequence(returnTabId)
}

function getMotionReturnTabAtMount(): string | null {
  const navigation = useCompositionNavigationStore.getState()
  const activeComposition = navigation.activeCompositionId
    ? useCompositionsStore.getState().compositionById[navigation.activeCompositionId]
    : undefined
  // On refresh/HMR the ephemeral Motion session state may be gone while the
  // persisted navigation is still inside Motion. Never capture that Motion id
  // as an Edit return target; Main is the safe editorial fallback.
  if (activeComposition?.editorKind === 'composite-2d') return null
  return getActiveTabId(navigation.breadcrumbs)
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
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const activeCompositionId = useCompositionNavigationStore((state) => state.activeCompositionId)
  const activeComposition = useCompositionsStore((state) =>
    activeCompositionId ? state.compositionById[activeCompositionId] : undefined,
  )
  const previewProject = useMemo(() => {
    if (activeComposition?.editorKind !== 'composite-2d') return null
    return {
      width: activeComposition.width,
      height: activeComposition.height,
      fps: activeComposition.fps,
    }
  }, [activeComposition])

  if (!previewProject) {
    return (
      <>
        <section
          className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-video-preview-background p-6"
          role="region"
          aria-label={t('editor.compose.title')}
          data-testid="motion-preview-empty"
        >
          <div className="flex max-w-sm flex-col items-center text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-panel-header text-primary shadow-sm">
              <Spline className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('editor.compose.emptyTitle')}
            </h2>
            <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
              {t('editor.compose.emptyDescription')}
            </p>
            <Button
              type="button"
              size="sm"
              className="mt-4 h-8 gap-1.5 text-xs"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('editor.compose.newComposition')}
            </Button>
          </div>
        </section>
        <NewCompositionDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          defaults={project}
        />
      </>
    )
  }

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
  const returnTabIdRef = useRef(getMotionReturnTabAtMount())
  const activeCompositionId = useCompositionNavigationStore((state) => state.activeCompositionId)
  const activeComposition = useCompositionsStore((state) =>
    activeCompositionId ? state.compositionById[activeCompositionId] : undefined,
  )
  const compositions = useCompositionsStore((state) => state.compositions)
  const motionCompositions = useMemo(
    () => compositions.filter((composition) => composition.editorKind === 'composite-2d'),
    [compositions],
  )
  const lastOpenedCompositionId = useComposeUiStore((state) => state.lastOpenedCompositionId)
  const setLastOpenedCompositionId = useComposeUiStore(
    (state) => state.setLastOpenedCompositionId,
  )

  useLayoutEffect(() => {
    useComposeUiStore.getState().captureMotionReturnTab(returnTabIdRef.current)
    const unsubscribeWorkspace = useEditorStore.subscribe((state, previousState) => {
      if (previousState.workspace === 'motion' && state.workspace !== 'motion') {
        // Zustand subscriptions run synchronously. Restore the editorial stores
        // before React renders the destination workspace's classic timeline.
        restoreMotionReturnTimeline()
      }
    })
    return () => {
      unsubscribeWorkspace()
      // Fallback for teardown paths that bypass the normal workspace setter.
      if (useEditorStore.getState().workspace !== 'motion') {
        restoreMotionReturnTimeline()
      }
    }
  }, [])

  useEffect(() => {
    usePlaybackStore.getState().pause()
  }, [])

  useEffect(() => {
    if (activeComposition?.editorKind !== 'composite-2d' || !activeCompositionId) return
    setLastOpenedCompositionId(activeCompositionId)
  }, [activeComposition, activeCompositionId, setLastOpenedCompositionId])

  useEffect(() => {
    if (activeComposition?.editorKind === 'composite-2d') return
    const target =
      motionCompositions.find((composition) => composition.id === lastOpenedCompositionId) ??
      motionCompositions[0]
    if (target) {
      useCompositionNavigationStore.getState().switchToSequence(target.id)
    }
  }, [activeComposition, lastOpenedCompositionId, motionCompositions])

  return (
    <ErrorBoundary level="feature">
      <CompositingTimeline className="h-full" defaults={project} />
    </ErrorBoundary>
  )
})
