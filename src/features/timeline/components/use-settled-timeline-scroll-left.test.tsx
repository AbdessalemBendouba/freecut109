import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { _resetViewportThrottle, useTimelineViewportStore } from '../stores/timeline-viewport-store'
import {
  EDIT_DOPESHEET_PAN_REBASE_VIEWPORT_RATIO,
  EDIT_DOPESHEET_PAN_SETTLE_MS,
  useSettledTimelineScrollLeft,
} from './use-settled-timeline-scroll-left'

describe('useSettledTimelineScrollLeft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetViewportThrottle()
    useTimelineViewportStore.getState().setViewportImmediate({
      scrollLeft: 0,
      scrollTop: 0,
      viewportWidth: 640,
      viewportHeight: 320,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes the live DOM position after pan settles', () => {
    const container = document.createElement('div')
    container.scrollLeft = 20
    const scrollContainerRef = { current: container }
    const { result } = renderHook(() =>
      useSettledTimelineScrollLeft(scrollContainerRef, true),
    )

    expect(result.current).toBe(20)

    act(() => {
      container.scrollLeft = 80
      container.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(EDIT_DOPESHEET_PAN_SETTLE_MS - 1)
    })
    expect(result.current).toBe(20)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(80)
  })

  it('rebases only after the compositor pan crosses a viewport-relative distance', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 200 })
    const scrollContainerRef = { current: container }
    const { result } = renderHook(() =>
      useSettledTimelineScrollLeft(scrollContainerRef, true),
    )

    const rebaseDistance = 200 * EDIT_DOPESHEET_PAN_REBASE_VIEWPORT_RATIO
    act(() => {
      container.scrollLeft = rebaseDistance - 1
      container.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(0)

    act(() => {
      container.scrollLeft = rebaseDistance
      container.dispatchEvent(new Event('scroll'))
    })
    expect(result.current).toBe(rebaseDistance)
  })
})
