// React and external libraries
import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react'

// Stores and selectors
import { usePlaybackStore } from '@/shared/state/playback'
import { useMicRecordingStore, isMicRecordingActive } from '@/shared/state/mic-recording-store'
import { useSelectionStore } from '@/shared/state/selection'

// Utilities and hooks
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle'
import { withPerfMeasure, perfMarkRender } from '@/shared/logging/perf-marks'
import { PlayheadMarks } from '@/shared/ui/playhead-marks'
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
      const container = inRuler
        ? playheadRef.current?.closest('.timeline-ruler')
        : playheadRef.current?.closest('.timeline-tracks')
      const scrollContainer = playheadRef.current?.closest(
        '.timeline-container',
      ) as HTMLDivElement | null
      const rect = scrollContainer?.getBoundingClientRect() ?? container?.getBoundingClientRect()
      const pointerX = rect
        ? e.clientX - rect.left + (scrollContainer?.scrollLeft ?? 0)
        : frameToPixelsRef.current(usePlaybackStore.getState().currentFrame)
      scrubClientXRef.current = e.clientX
      scrubAnimationTimeRef.current = null
      scrubScrollContainerRef.current = scrollContainer
      scrubPlayheadElementsRef.current = scrollContainer
        ? Array.from(
            scrollContainer.querySelectorAll<HTMLElement>('[data-timeline-playhead]'),
          )
        : playheadRef.current
          ? [playheadRef.current]
          : []
      scrubThrottleStateRef.current = createScrubThrottleState({
        pointerX,
        frame: usePlaybackStore.getState().currentFrame,
        nowMs: performance.now(),
      })
      isDraggingRef.current = true
      setIsDragging(true)
    },
    [inRuler],
  )

  // Handle dragging
  useEffect(() => {
    if (!isDragging) return

    // Apply grabbing cursor globally to prevent flickering
    const originalCursor = document.body.style.cursor
    document.body.style.cursor = 'grabbing'

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
            scrollContainer.scrollLeft += getEdgeScrollDelta(
              velocity,
              timestamp,
              previousTimestamp,
            )
            scrubAnimationTimeRef.current = timestamp
          } else {
            scrubAnimationTimeRef.current = null
          }
        }

        const coordinateBounds =
          scrollContainer?.getBoundingClientRect() ??
          (inRuler
            ? playheadRef.current?.closest('.timeline-ruler')?.getBoundingClientRect()
            : playheadRef.current?.closest('.timeline-tracks')?.getBoundingClientRect())
        if (!coordinateBounds) return

        const scrollLeft = scrollContainer?.scrollLeft ?? 0
        const pointerX = clientX - coordinateBounds.left + scrollLeft
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

        const visualClientX = getVisiblePlayheadClientX(clientX, coordinateBounds)
        const visualTimelineX = visualClientX - coordinateBounds.left + scrollLeft
        for (const element of scrubPlayheadElementsRef.current) {
          element.style.transform = `translate3d(${visualTimelineX}px, 0, 0)`
        }
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
      const bounds =
        scrollContainer?.getBoundingClientRect() ??
        (inRuler
          ? playheadRef.current?.closest('.timeline-ruler')?.getBoundingClientRect()
          : playheadRef.current?.closest('.timeline-tracks')?.getBoundingClientRect())
      if (clientX !== null && bounds) {
        const pointerX = clientX - bounds.left + (scrollContainer?.scrollLeft ?? 0)
        let frame = Math.max(0, Math.round(pixelsToFrameRef.current(pointerX)))
        if (maxFrameRef.current !== undefined) frame = Math.min(frame, maxFrameRef.current)
        setScrubFrameRef.current(frame)
      }

      isDraggingRef.current = false
      scrubClientXRef.current = null
      scrubAnimationTimeRef.current = null
      scrubScrollContainerRef.current = null
      scrubPlayheadElementsRef.current = []
      setPreviewFrameRef.current(null)
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
    }
  }, [isDragging, inRuler]) // Stable dependencies - no stale closures

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
            cursor:
              activeToolRef.current === 'razor' ? 'default' : isDragging ? 'grabbing' : 'default',
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
