import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { ZOOM_MAX, ZOOM_MIN } from '../constants'
import { useZoomStore } from '../stores/zoom-store'
import { TimelineHeader } from './timeline-header'

const { micRenderSpy } = vi.hoisted(() => ({ micRenderSpy: vi.fn() }))

vi.mock('@/components/ui/slider', async () => {
  const { forwardRef } = await vi.importActual<typeof import('react')>('react')

  return {
    Slider: forwardRef<
      HTMLSpanElement,
      {
        value?: number[]
        onValueChange?: (value: number[]) => void
        onValueCommit?: (value: number[]) => void
      }
    >(function MockSlider({ value, onValueChange, onValueCommit }, ref) {
      return (
        <span ref={ref} data-testid="zoom-slider" data-value={value?.[0]}>
          <span>
            <span data-testid="zoom-slider-range" />
          </span>
          <span data-testid="zoom-slider-thumb-positioner">
            <button
              type="button"
              role="slider"
              aria-valuenow={value?.[0]}
              onMouseDown={() => onValueChange?.([0.75])}
              onMouseUp={() => onValueCommit?.([0.75])}
            />
          </span>
        </span>
      )
    }),
  }
})

vi.mock('./mic-record-control', () => ({
  MicRecordControl: () => {
    micRenderSpy()
    return null
  },
}))

describe('TimelineHeader zoom slider', () => {
  beforeEach(() => {
    micRenderSpy.mockClear()
    useZoomStore.getState().setZoomLevelSynchronized(1)
  })

  it('previews pointer input immediately and commits without slider-only momentum', () => {
    const animationFrameSpy = vi.spyOn(window, 'requestAnimationFrame')
    const onZoomChange = vi.fn()
    const targetZoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, 0.75)

    render(<TimelineHeader onZoomChange={onZoomChange} />)
    expect(micRenderSpy).toHaveBeenCalledTimes(1)

    const slider = screen.getByTestId('zoom-slider')
    fireEvent.mouseDown(screen.getByRole('slider'))

    expect(screen.getByTestId('zoom-slider-thumb-positioner').style.left).toBe('calc(75% - 4px)')
    expect(screen.getByTestId('zoom-slider-range').style.right).toBe('25%')
    expect(onZoomChange).toHaveBeenLastCalledWith(targetZoom)
    expect(animationFrameSpy).not.toHaveBeenCalled()
    expect(micRenderSpy).toHaveBeenCalledTimes(1)
    expect(useZoomStore.getState().level).toBe(1)

    fireEvent.mouseUp(screen.getByRole('slider'))

    expect(onZoomChange).toHaveBeenCalledTimes(1)
    expect(onZoomChange).toHaveBeenLastCalledWith(targetZoom)
    expect(animationFrameSpy).not.toHaveBeenCalled()

    act(() => useZoomStore.getState().setZoomLevelImmediate(targetZoom))
    expect(Number(slider.dataset.value)).toBeCloseTo(0.75)
    expect(micRenderSpy).toHaveBeenCalledTimes(1)

    animationFrameSpy.mockRestore()
  })
})
