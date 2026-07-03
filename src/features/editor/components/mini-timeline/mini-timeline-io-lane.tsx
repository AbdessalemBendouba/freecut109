import { memo, useCallback, useEffect, useRef, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  setInOutPointsWithoutHistory,
  useTimelineSettingsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import type { TimelineAnnotationModel } from '@/shared/timeline/timeline-annotations'
import { IoRangeHandles, IoRangeStrip, useMeasuredWidth } from '@/shared/timeline/io-range'
import { MINI_TIMELINE_IO_HANDLE_WIDTH, MINI_TIMELINE_IO_LANE_HEIGHT } from './constants'

/**
 * The IO bar's own lane (DaVinci-style). Renders the in/out range strip (drag
 * the body to slide the whole range, preserving length) and the in/out drag
 * handles, mirroring the Edit-workspace in/out markers. While dragging it pins
 * the host playhead via `suppressPlayheadPreviewRef` so the playhead doesn't
 * chase the markers while the preview canvas keeps updating. The guide lines
 * that span the track rows below live in {@link MiniTimelineAnnotations}.
 */
export const MiniTimelineIoLane = memo(function MiniTimelineIoLane({
  model,
  timelineMaxFrame,
  labelWidth,
  suppressPlayheadPreviewRef,
  testIdPrefix,
}: {
  model: TimelineAnnotationModel
  timelineMaxFrame: number
  labelWidth: number
  suppressPlayheadPreviewRef: { current: boolean }
  testIdPrefix: string
}) {
  const { t } = useTranslation()
  const setInPoint = useTimelineStore((s) => s.setInPoint)
  const setOutPoint = useTimelineStore((s) => s.setOutPoint)
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)

  const laneRef = useRef<HTMLDivElement>(null)
  // Lane pixel width — the ratios above render fluidly, but the handles need the
  // real span in px to avoid overlapping into a block when the range is narrow.
  const laneWidth = useMeasuredWidth(laneRef)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const maxFrameRef = useRef(timelineMaxFrame)
  maxFrameRef.current = timelineMaxFrame
  const settersRef = useRef({ in: setInPoint, out: setOutPoint })
  settersRef.current = { in: setInPoint, out: setOutPoint }
  const inOutRef = useRef({ in: inPoint, out: outPoint })
  inOutRef.current = { in: inPoint, out: outPoint }

  // Tear down any in-flight drag if the lane unmounts mid-gesture.
  useEffect(() => () => dragCleanupRef.current?.(), [])

  // Drag the whole strip to slide the in/out range together, preserving its
  // length (mirrors the Edit-workspace ruler range drag: no history per move,
  // mark dirty on release).
  const startRangeDrag = useCallback(
    (event: PointerEvent) => {
      if (event.button !== 0) return
      const { in: startIn, out: startOut } = inOutRef.current
      if (startIn === null || startOut === null) return
      event.preventDefault()
      event.stopPropagation()
      const lane = laneRef.current
      if (!lane) return

      const startClientX = event.clientX
      const span = Math.max(1, startOut - startIn)
      const prevCursor = document.body.style.cursor
      document.body.style.cursor = 'grabbing'
      // Keep the preview live but pin the host playhead while dragging.
      suppressPlayheadPreviewRef.current = true
      let lastIn = startIn

      const onMove = (ev: globalThis.PointerEvent) => {
        const rect = lane.getBoundingClientRect()
        if (rect.width <= 0) return
        const frameDelta = Math.round(
          ((ev.clientX - startClientX) / rect.width) * maxFrameRef.current,
        )
        const maxIn = Math.max(0, maxFrameRef.current - span)
        const nextIn = Math.max(0, Math.min(startIn + frameDelta, maxIn))
        if (nextIn === lastIn) return
        lastIn = nextIn
        setInOutPointsWithoutHistory(nextIn, nextIn + span)
        // Preview follows the leading edge; the playhead stays put (suppressed).
        usePlaybackStore.getState().setPreviewFrame(nextIn)
      }
      const cleanup = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', cleanup)
        document.removeEventListener('pointercancel', cleanup)
        document.body.style.cursor = prevCursor
        usePlaybackStore.getState().setPreviewFrame(null)
        suppressPlayheadPreviewRef.current = false
        useTimelineSettingsStore.getState().markDirty()
        dragCleanupRef.current = null
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', cleanup)
      document.addEventListener('pointercancel', cleanup)
      dragCleanupRef.current = cleanup
    },
    [suppressPlayheadPreviewRef],
  )

  const startDrag = useCallback(
    (side: 'in' | 'out') => (event: PointerEvent) => {
      if (event.button !== 0) return
      // Claim the gesture so the scrub surface underneath doesn't also seek.
      event.preventDefault()
      event.stopPropagation()
      const lane = laneRef.current
      if (!lane) return

      const setFrame = settersRef.current[side]
      const prevCursor = document.body.style.cursor
      document.body.style.cursor = 'col-resize'
      // Keep the preview live but pin the host playhead while dragging.
      suppressPlayheadPreviewRef.current = true

      const onMove = (ev: globalThis.PointerEvent) => {
        const rect = lane.getBoundingClientRect()
        if (rect.width <= 0) return
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
        const frame = Math.round(ratio * maxFrameRef.current)
        setFrame(frame)
        // Skim the preview to the boundary; out is exclusive, so show out - 1.
        const previewFrame = side === 'out' ? Math.max(0, frame - 1) : frame
        usePlaybackStore.getState().setPreviewFrame(previewFrame)
      }
      const cleanup = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', cleanup)
        document.removeEventListener('pointercancel', cleanup)
        document.body.style.cursor = prevCursor
        usePlaybackStore.getState().setPreviewFrame(null)
        suppressPlayheadPreviewRef.current = false
        dragCleanupRef.current = null
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', cleanup)
      document.addEventListener('pointercancel', cleanup)
      dragCleanupRef.current = cleanup
    },
    [suppressPlayheadPreviewRef],
  )

  const inRatio = model.inPoint?.positionRatio ?? null
  const outRatio = model.outPoint?.positionRatio ?? null
  const spanPx = inRatio !== null && outRatio !== null ? (outRatio - inRatio) * laneWidth : null

  return (
    <div
      ref={laneRef}
      className="pointer-events-none absolute inset-y-0 right-0"
      data-testid={`${testIdPrefix}-io-lane`}
      style={{ left: labelWidth }}
    >
      {model.ioRange ? (
        <IoRangeStrip
          left={`${model.ioRange.startRatio * 100}%`}
          width={`${(model.ioRange.endRatio - model.ioRange.startRatio) * 100}%`}
          height={MINI_TIMELINE_IO_LANE_HEIGHT}
          onDragStart={startRangeDrag}
          testId={`${testIdPrefix}-io-strip`}
          zIndex={1}
        />
      ) : null}

      <IoRangeHandles
        inLeft={inRatio !== null ? `${inRatio * 100}%` : null}
        outLeft={outRatio !== null ? `${outRatio * 100}%` : null}
        spanPx={spanPx}
        laneHeight={MINI_TIMELINE_IO_LANE_HEIGHT}
        handleWidth={MINI_TIMELINE_IO_HANDLE_WIDTH}
        zIndex={2}
        onInDragStart={startDrag('in')}
        onOutDragStart={startDrag('out')}
        inTitle={t('editor.miniTimeline.inPoint')}
        outTitle={t('editor.miniTimeline.outPoint')}
        testIdPrefix={testIdPrefix}
      />
    </div>
  )
})
