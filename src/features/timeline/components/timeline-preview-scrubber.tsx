import { TimelinePreviewScrubberVisual } from '@/shared/ui/timeline-preview-scrubber-visual'
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context'
import { IO_LANE_HEIGHT } from './timeline-markers'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'

interface TimelinePreviewScrubberProps {
  inRuler?: boolean
  maxFrame?: number
}

/** Main timeline adapter for the shared preview scrubber visual. */
export function TimelinePreviewScrubber({
  inRuler = false,
  maxFrame,
}: TimelinePreviewScrubberProps) {
  const { frameToPixels, fps } = useTimelineZoomContext()

  return (
    <TimelinePreviewScrubberVisual
      frameToPixels={frameToPixels}
      fps={fps}
      inRuler={inRuler}
      maxFrame={maxFrame}
      rulerOffset={IO_LANE_HEIGHT}
      suppressRef={previewScrubberSuppressRef}
    />
  )
}
