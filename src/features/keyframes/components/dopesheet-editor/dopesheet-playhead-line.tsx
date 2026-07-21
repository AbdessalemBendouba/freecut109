/**
 * Self-positioning unified playhead for the dope sheet timeline.
 *
 * The flag and full-height line are rendered by one element. During playback
 * this component updates its position directly so the editor does not need to
 * re-render on every frame.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import {
  mainTimelineScrubActiveRef,
  mainTimelineScrubHandoffFrameRef,
} from '@/shared/timeline/main-timeline-scrub'
import { TIMELINE_LIVE_SCROLL_EVENT } from '@/shared/timeline/live-scroll-sync'

interface DopesheetPlayheadLineProps {
  /** Clip-relative playhead frame for paused seek and zoom updates. */
  relativeFrame: number
  /** Absolute timeline frame where the edited item starts. */
  itemFrom: number
  /** Item duration in frames. */
  totalFrames: number
  /** Whether live playback should stop at the edited clip's bounds. */
  clampToItemBounds?: boolean
  /** Whether the committed playhead should follow transient preview/skim frames. */
  followPreviewFrame?: boolean
  /** Convert a clip-relative frame to x within the timeline viewport. */
  frameToX: (frame: number) => number
  /** Exact shared Edit-axis mapper. Receives an absolute timeline frame. */
  globalFrameToX?: (globalFrame: number) => number
  /** Live scroll surface that should reposition this playhead before React commits. */
  positionSyncTargetRef?: RefObject<HTMLElement | null>
  /** Upper clamp for the playhead's left position. */
  maxLeft: number
  /** Pin the playhead to the visible viewport instead of letting its clip hide it. */
  clampToViewport?: boolean
  className?: string
}

export function DopesheetPlayheadLine({
  relativeFrame,
  itemFrom,
  totalFrames,
  clampToItemBounds = true,
  followPreviewFrame = true,
  frameToX,
  globalFrameToX,
  positionSyncTargetRef,
  maxLeft,
  clampToViewport = true,
  className,
}: DopesheetPlayheadLineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const posRef = useRef({
    frameToX,
    maxLeft,
    itemFrom,
    totalFrames,
    relativeFrame,
    clampToItemBounds,
    followPreviewFrame,
    globalFrameToX,
    clampToViewport,
  })
  posRef.current = {
    frameToX,
    maxLeft,
    itemFrom,
    totalFrames,
    relativeFrame,
    clampToItemBounds,
    followPreviewFrame,
    globalFrameToX,
    clampToViewport,
  }

  const clampLeft = (frame: number): number => {
    const pos = posRef.current
    const mappedX = pos.globalFrameToX
      ? pos.globalFrameToX(pos.itemFrom + frame)
      : pos.frameToX(frame)
    return pos.clampToViewport ? Math.max(0, Math.min(pos.maxLeft, mappedX)) : mappedX
  }

  const livePlaybackRelFrame = (): number | null => {
    const state = usePlaybackStore.getState()
    const isPreviewing = state.previewFrame !== null
    const pos = posRef.current
    const isMainTimelineScrubbing = mainTimelineScrubActiveRef.current
    const followTransientFrame = pos.followPreviewFrame || isMainTimelineScrubbing

    if (isMainTimelineScrubbing) {
      mainTimelineScrubHandoffFrameRef.current = state.previewFrame ?? state.currentFrame
    } else if (mainTimelineScrubHandoffFrameRef.current !== null) {
      const propGlobalFrame = pos.itemFrom + pos.relativeFrame
      if (propGlobalFrame === mainTimelineScrubHandoffFrameRef.current) {
        mainTimelineScrubHandoffFrameRef.current = null
      } else {
        const relative = mainTimelineScrubHandoffFrameRef.current - pos.itemFrom
        if (!pos.clampToItemBounds) return relative
        const lastFrame = Math.max(0, (pos.totalFrames || 1) - 1)
        return Math.max(0, Math.min(lastFrame, relative))
      }
    }

    if (
      !state.isPlaying &&
      !isMainTimelineScrubbing &&
      (!isPreviewing || !followTransientFrame)
    ) {
      return null
    }
    const frame = followTransientFrame
      ? (state.previewFrame ?? state.currentFrame)
      : state.currentFrame
    const relative = frame - pos.itemFrom
    if (!pos.clampToItemBounds) return relative
    const lastFrame = Math.max(0, (pos.totalFrames || 1) - 1)
    return Math.max(0, Math.min(lastFrame, relative))
  }

  useLayoutEffect(() => {
    if (!ref.current) return
    const liveRelativeFrame = livePlaybackRelFrame()
    const x = clampLeft(liveRelativeFrame ?? posRef.current.relativeFrame)
    ref.current.style.transform = `translate3d(${x}px, 0, 0)`
  })

  useEffect(() => {
    const update = () => {
      const liveRelativeFrame = livePlaybackRelFrame()
      const relativeFrame = liveRelativeFrame ?? posRef.current.relativeFrame
      if (ref.current) {
        ref.current.style.transform = `translate3d(${clampLeft(relativeFrame)}px, 0, 0)`
      }
    }
    const unsubscribe = usePlaybackStore.subscribe(update)
    const target = positionSyncTargetRef?.current
    target?.addEventListener('scroll', update, { passive: true })
    target?.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, update)
    return () => {
      unsubscribe()
      target?.removeEventListener('scroll', update)
      target?.removeEventListener(TIMELINE_LIVE_SCROLL_EVENT, update)
    }
    // Positioning inputs are read from posRef so this subscription stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionSyncTargetRef])

  return (
    <div ref={ref} data-testid="dopesheet-playhead-line" className={className}>
      <PlayheadMarks handle="flag" />
    </div>
  )
}
