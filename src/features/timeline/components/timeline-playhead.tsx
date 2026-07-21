// React and external libraries
import { useState, useCallback, useEffect, useRef, useLayoutEffect, type RefObject } from 'react'

// Stores and selectors
import { usePlaybackStore } from '@/shared/state/playback'
import { useMicRecordingStore, isMicRecordingActive } from '@/shared/state/mic-recording-store'
import { useSelectionStore } from '@/shared/state/selection'

// Utilities and hooks
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle'
import { withPerfMeasure, perfMarkRender } from '@/shared/logging/perf-marks'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
import { mainTimelineScrubActiveRef } from '@/shared/timeline/main-timeline-scrub'
import {
  TIMELINE_SCRUB_VISUAL_FRAME_EVENT,
  notifyTimelineScrubVisualFrame,
  type TimelineScrubVisualFrameDetail,
} from '@/shared/timeline/live-scroll-sync'
import {
  getEdgeScrollDelta,
  getPlayheadEdgeScrollVelocity,
  getVisiblePlayheadClientX,
} from '../utils/playhead-edge-scroll'

interface TimelinePlayheadProps {
  inRuler?: boolean // If true, shows diamond indicator for ruler
  maxFrame?: number // Maximum frame the playhead can be dragged to (content duration)
  // Drop the marks below the ruler's top IO lane so the flag doesn't share it.
  topOffsetPx?: number
  coordinateSurfaceRef?: RefObject<HTMLDivElement | null>
}

function getPlayheadDragSurfaces({
  playhead,
  explicitCoordinateSurface,
  inRuler,
}: {
  playhead: HTMLDivElement | null
  explicitCoordinateSurface: HTMLDivElement | null
  inRuler: boolean
}): {
  scrollContainer: HTMLDivElement | null
  coordinateSurface: HTMLDivElement | null
} {
  if (!playhead) {
    return { scrollContainer: null, coordinateSurface: explicitCoordinateSurface }
  }

  const scrollContainer = playhead.closest<HTMLDivElement>('.timeline-container')
  const fallbackSurface = inRuler
    ? playhead.closest<HTMLDivElement>('.timeline-ruler')
    : playhead.closest<HTMLDivElement>('.timeline-tracks')
  const coordinateSurface = explicitCoordinateSurface ?? (scrollContainer ? null : fallbackSurface)

  return { scrollContainer, coordinateSurface }
}

function getPlayheadPointerX(
  coordinateSurface: HTMLDivElement | null,
  scrollContainer: HTMLDivElement | null,
  clientX: number,
  fallbackX: number,
): number {
  if (coordinateSurface) {
    return clientX - coordinateSurface.getBoundingClientRect().left
  }
  if (scrollContainer) {
    return clientX - scrollContainer.getBoundingClientRect().left + scrollContainer.scrollLeft
  }

  return fallbackX
}

/**
 * Timeline Playhead Component
 *
 * Renders the playhead indicator that shows the current frame position
 * - Vertical line across all tracks
 * - Diamond indicator in ruler when inRuler=true
 * - Synchronized with playback store via manual subscription (no re-renders during playback)
 * - Draggable for scrubbing through timeline
 */
export function TimelinePlayhead({
  inRuler = false,
  maxFrame,
  topOffsetPx = 0,
  coordinateSurfaceRef,
}: TimelinePlayheadProps) {
  perfMarkRender('TimelinePlayhead')
  // Don't subscribe to currentFrame - use ref + manual subscription instead
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame)
  const { frameToPixels, pixelsToFrame, pixelsPerSecond } = useTimelineZoomContext()

  const [isDragging, setIsDragging] = useState(false)
  const [isExternalDrag, setIsExternalDrag] = useState(false)
  const playheadRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  // Track activeTool via ref subscription to avoid re-renders during playback
  // This prevents mode toggle from interrupting frame updates
  const activeToolRef = useRef(useSelectionStore.getState().activeTool)
  useEffect(() => {
    return useSelectionStore.subscribe((state) => {
      activeToolRef.current = state.activeTool
    })
  }, [])

  // Use refs to avoid stale closures
  const pixelsToFrameRef = useRef(pixelsToFrame)
  const setScrubFrameRef = useRef(setScrubFrame)
  const maxFrameRef = useRef(maxFrame)
  const frameToPixelsRef = useRef(frameToPixels)
  const pixelsPerSecondRef = useRef(pixelsPerSecond)

  // RAF throttling refs for smooth scrubbing without excessive state updates
  const rafIdRef = useRef<number | null>(null)
  const scrubClientXRef = useRef<number | null>(null)
  const scrubAnimationTimeRef = useRef<number | null>(null)
  const scrubScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrubCoordinateSurfaceRef = useRef<HTMLDivElement | null>(null)
  const scrubPlayheadElementsRef = useRef<HTMLElement[]>([])
  const scrubThrottleStateRef = useRef(
    createScrubThrottleState({
      frame: usePlaybackStore.getState().currentFrame,
      nowMs: performance.now(),
    }),
  )
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame)
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame
    })
  }, [])

  // Update refs when functions change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame
    setScrubFrameRef.current = setScrubFrame
    maxFrameRef.current = maxFrame
    frameToPixelsRef.current = frameToPixels
    pixelsPerSecondRef.current = pixelsPerSecond
  }, [pixelsToFrame, setScrubFrame, maxFrame, frameToPixels, pixelsPerSecond])

  useEffect(() => {
    isDraggingRef.current = isDragging
  }, [isDragging])

  // Subscribe to playback frame changes and update position directly.
  // During playhead drags, use the same atomic scrub state as the main ruler
  // so the fast-scrub overlay hands back to the player consistently.
  useEffect(() => {
    const updatePosition = (frame: number) => {
      if (!playheadRef.current) return
      const leftPosition = Math.round(frameToPixelsRef.current(frame))
      // Use transform (compositor-only) instead of style.left (triggers layout).
      playheadRef.current.style.transform = `translate3d(${leftPosition}px, 0, 0)`
    }

    // Initial update
    updatePosition(usePlaybackStore.getState().currentFrame)

    // Subscribe to store changes
    return usePlaybackStore.subscribe((state) => {
      updatePosition(
        isDraggingRef.current && state.previewFrame !== null
          ? state.previewFrame
          : state.currentFrame,
      )
    })
  }, [])

  // Also update position when frameToPixels changes (zoom changes)
  useLayoutEffect(() => {
    if (!playheadRef.current) return
    const playbackState = usePlaybackStore.getState()
    const frame =
      isDraggingRef.current && playbackState.previewFrame !== null
        ? playbackState.previewFrame
        : playbackState.currentFrame
    const leftPosition = Math.round(frameToPixels(frame))
    playheadRef.current.style.transform = `translate3d(${leftPosition}px, 0, 0)`
  }, [frameToPixels, isDragging])

  useEffect(() => {
    const scrollContainer = playheadRef.current?.closest<HTMLDivElement>('.timeline-container')
    if (!scrollContainer) return

    const updateFromLinkedScrub = (event: Event) => {
      const { frame, source } = (event as CustomEvent<TimelineScrubVisualFrameDetail>).detail
      if (source !== 'keyframe' || !playheadRef.current) return
      const clampedFrame = Math.max(0, Math.min(frame, maxFrameRef.current ?? frame))
      playheadRef.current.style.transform = `translate3d(${Math.round(
        frameToPixelsRef.current(clampedFrame),
      )}px, 0, 0)`
    }

    scrollContainer.addEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, updateFromLinkedScrub)
    return () => {
      scrollContainer.removeEventListener(TIMELINE_SCRUB_VISUAL_FRAME_EVENT, updateFromLinkedScrub)
    }
  }, [])

  // Track external drag operations to disable pointer events on hit areas
  useEffect(() => {
    const handleDragStart = () => setIsExternalDrag(true)
    const handleDragEnd = () => setIsExternalDrag(false)

    document.addEventListener('dragstart', handleDragStart)
    document.addEventListener('dragend', handleDragEnd)
    document.addEventListener('drop', handleDragEnd)

    return () => {
      document.removeEventListener('dragstart', handleDragStart)
      document.removeEventListener('dragend', handleDragEnd)
      document.removeEventListener('drop', handleDragEnd)
    }
  }, [])

  // Handle drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Seeking is disabled during a voiceover take (see timeline-markers).
      if (isMicRecordingActive(useMicRecordingStore.getState().status)) return
      const { scrollContainer, coordinateSurface } = getPlayheadDragSurfaces({
        playhead: playheadRef.current,
        explicitCoordinateSurface: coordinateSurfaceRef?.current ?? null,
        inRuler,
      })
      const pointerX = getPlayheadPointerX(
        coordinateSurface,
        scrollContainer,
        e.clientX,
        frameToPixelsRef.current(usePlaybackStore.getState().currentFrame),
      )
      scrubClientXRef.current = e.clientX
      scrubAnimationTimeRef.current = null
      scrubScrollContainerRef.current = scrollContainer
      scrubCoordinateSurfaceRef.current = coordinateSurface
      scrubPlayheadElementsRef.current = scrollContainer
        ? Array.from(scrollContainer.querySelectorAll<HTMLElement>('[data-timeline-playhead]'))
        : playheadRef.current
          ? [playheadRef.current]
          : []
      scrubThrottleStateRef.current = createScrubThrottleState({
        pointerX,
        frame: usePlaybackStore.getState().currentFrame,
        nowMs: performance.now(),
      })
      isDraggingRef.current = true
      mainTimelineScrubActiveRef.current = true
      setIsDragging(true)
    },
    [coordinateSurfaceRef, inRuler],
  )

  // Handle dragging
  useEffect(() => {
    if (!isDragging) return

    // Keep the horizontal scrub cursor stable while crossing timeline children.
    const originalCursor = document.body.style.cursor
    document.body.style.cursor = 'ew-resize'

    const runScrubLoop = (timestamp: number) => {
      rafIdRef.current = null
      const clientX = scrubClientXRef.current
      if (clientX === null) return

      withPerfMeasure('tl.raf.playheadScrub', () => {
        const scrollContainer = scrubScrollContainerRef.current
        const bounds = scrollContainer?.getBoundingClientRect()
        if (scrollContainer && bounds) {
          const velocity = getPlayheadEdgeScrollVelocity(clientX, bounds)
          const canScroll =
            (velocity < 0 && scrollContainer.scrollLeft > 0) ||
            (velocity > 0 &&
              scrollContainer.scrollLeft + scrollContainer.clientWidth <
                scrollContainer.scrollWidth)
          if (velocity !== 0 && canScroll) {
            const previousTimestamp = scrubAnimationTimeRef.current ?? timestamp - 1000 / 60
            scrollContainer.scrollLeft += getEdgeScrollDelta(velocity, timestamp, previousTimestamp)
            scrubAnimationTimeRef.current = timestamp
          } else {
            scrubAnimationTimeRef.current = null
          }
        }

        const coordinateSurface = scrubCoordinateSurfaceRef.current
        const coordinateBounds =
          coordinateSurface?.getBoundingClientRect() ?? scrollContainer?.getBoundingClientRect()
        if (!coordinateBounds) return

        const scrollLeft = scrollContainer?.scrollLeft ?? 0
        const coordinateScrollOffset = coordinateSurface ? 0 : scrollLeft
        const pointerX = clientX - coordinateBounds.left + coordinateScrollOffset
        let targetFrame = Math.max(0, Math.round(pixelsToFrameRef.current(pointerX)))
        if (maxFrameRef.current !== undefined) {
          targetFrame = Math.min(targetFrame, maxFrameRef.current)
        }

        if (
          shouldCommitScrubFrame({
            state: scrubThrottleStateRef.current,
            pointerX,
            targetFrame,
            pixelsPerSecond: pixelsPerSecondRef.current,
            nowMs: performance.now(),
          })
        ) {
          setScrubFrameRef.current(targetFrame)
        }

        const viewportBounds = scrollContainer?.getBoundingClientRect() ?? coordinateBounds
        const visualClientX = getVisiblePlayheadClientX(clientX, viewportBounds)
        const pointerTimelineX = visualClientX - coordinateBounds.left + coordinateScrollOffset
        const maxTimelineX =
          maxFrameRef.current === undefined
            ? undefined
            : frameToPixelsRef.current(maxFrameRef.current)
        const visualTimelineX =
          maxTimelineX === undefined
            ? pointerTimelineX
            : Math.max(scrollLeft, Math.min(pointerTimelineX, maxTimelineX))
        for (const element of scrubPlayheadElementsRef.current) {
          element.style.transform = `translate3d(${visualTimelineX}px, 0, 0)`
        }
        notifyTimelineScrubVisualFrame(scrollContainer, {
          frame: targetFrame,
          source: 'main',
        })
      })

      if (isDraggingRef.current) rafIdRef.current = requestAnimationFrame(runScrubLoop)
    }

    const handleMouseMove = (e: MouseEvent) => {
      scrubClientXRef.current = e.clientX
    }

    const handleMouseUp = () => {
      // Cancel any pending RAF before clearing preview to prevent resurrection
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }

      const clientX = scrubClientXRef.current
      const scrollContainer = scrubScrollContainerRef.current
      const coordinateSurface = scrubCoordinateSurfaceRef.current
      const bounds =
        coordinateSurface?.getBoundingClientRect() ?? scrollContainer?.getBoundingClientRect()
      if (clientX !== null && bounds) {
        const pointerX =
          clientX - bounds.left + (coordinateSurface ? 0 : (scrollContainer?.scrollLeft ?? 0))
        let frame = Math.max(0, Math.round(pixelsToFrameRef.current(pointerX)))
        if (maxFrameRef.current !== undefined) frame = Math.min(frame, maxFrameRef.current)
        setScrubFrameRef.current(frame)
      }

      isDraggingRef.current = false
      scrubClientXRef.current = null
      scrubAnimationTimeRef.current = null
      scrubScrollContainerRef.current = null
      scrubCoordinateSurfaceRef.current = null
      scrubPlayheadElementsRef.current = []
      setPreviewFrameRef.current(null)
      // Keep the shared flag set through the preview-clear notification so the
      // keyframe playhead retains the final scrub position until props settle.
      mainTimelineScrubActiveRef.current = false
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    rafIdRef.current = requestAnimationFrame(runScrubLoop)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // Restore original cursor
      document.body.style.cursor = originalCursor
      // Cancel any pending RAF to prevent memory leaks
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      scrubAnimationTimeRef.current = null
      mainTimelineScrubActiveRef.current = false
    }
  }, [isDragging]) // Stable dependencies - no stale closures

  return (
    <div
      ref={playheadRef}
      data-timeline-playhead={inRuler ? 'ruler' : 'tracks'}
      className="absolute top-0 bottom-0"
      style={{
        // left is set via ref subscription in useEffect (no re-renders during playback)
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* Shared line + (ruler-only) flag handle. */}
      <PlayheadMarks handle={inRuler ? 'flag' : 'none'} topOffsetPx={topOffsetPx} />

      {/* Invisible larger hit area over the flag — draggable to scrub. */}
      {inRuler && (
        <div
          className="absolute"
          style={{
            top: `${topOffsetPx}px`,
            left: '0px',
            width: '20px',
            height: '20px',
            transform: 'translateX(-50%)',
            cursor: activeToolRef.current === 'razor' ? 'default' : 'ew-resize',
            // Pass through pointer events in razor mode or during external drag operations
            pointerEvents: activeToolRef.current === 'razor' || isExternalDrag ? 'none' : 'auto',
            backgroundColor: 'transparent',
          }}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  )
}
