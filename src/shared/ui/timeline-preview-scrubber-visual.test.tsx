import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { usePlaybackStore } from '@/shared/state/playback'
import { TimelinePreviewScrubberVisual } from './timeline-preview-scrubber-visual'

describe('TimelinePreviewScrubberVisual', () => {
  beforeEach(() => {
    usePlaybackStore.setState({ previewFrame: null, previewItemId: null })
  })

  it('preserves subpixel coordinates so shared timeline skim lines stay aligned', () => {
    const { rerender } = render(
      <TimelinePreviewScrubberVisual frameToPixels={() => 12.375} fps={30} />,
    )

    act(() => usePlaybackStore.getState().setPreviewFrame(10))

    expect(screen.getByTestId('timeline-preview-scrubber')).toHaveStyle({
      transform: 'translate3d(12.375px, 0, 0)',
    })

    rerender(<TimelinePreviewScrubberVisual frameToPixels={() => 28.625} fps={30} />)
    expect(screen.getByTestId('timeline-preview-scrubber')).toHaveStyle({
      transform: 'translate3d(28.625px, 0, 0)',
    })
  })

  it('repositions from a live scroll axis without waiting for a React render', () => {
    const scrollTarget = document.createElement('div')
    scrollTarget.scrollLeft = 20
    render(
      <TimelinePreviewScrubberVisual
        frameToPixels={(frame) => frame - scrollTarget.scrollLeft}
        fps={30}
        positionSyncTargetRef={{ current: scrollTarget }}
      />,
    )

    act(() => usePlaybackStore.getState().setPreviewFrame(100))
    const skim = screen.getByTestId('timeline-preview-scrubber')
    expect(skim).toHaveStyle({ transform: 'translate3d(80px, 0, 0)' })

    scrollTarget.scrollLeft = 55
    fireEvent.scroll(scrollTarget)

    expect(skim).toHaveStyle({ transform: 'translate3d(45px, 0, 0)' })
  })
})
