import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useKeyframesStore, useTimelineCommandStore } from '@/features/editor/deps/timeline-motion'
import { useLinkedTransformPickWhip } from './use-linked-transform-pick-whip'

function PickWhipHarness() {
  const { drag, begin } = useLinkedTransformPickWhip()
  return (
    <div data-testid="motion-layer-scroll-area">
      <div data-expression-item-id="target" data-expression-property="x">
        <button type="button" onPointerDown={(event) => begin(event, 'target', 'x')}>
          Target X
        </button>
      </div>
      <div data-testid="source-row" data-expression-item-id="source" data-expression-property="y">
        Source Y
      </div>
      <div
        data-testid="shape-source-row"
        data-expression-item-id="shape-source"
        data-expression-property="trimPathEnd"
      >
        Shape Trim End
      </div>
      {drag ? (
        <span
          data-testid="active-pick-whip"
          data-start-x={drag.startX}
          data-start-y={drag.startY}
          data-clip-top={drag.clipBounds.top}
          data-clip-bottom={drag.clipBounds.bottom}
        />
      ) : null}
    </div>
  )
}

describe('useLinkedTransformPickWhip', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useKeyframesStore.getState().setKeyframes([])
  })

  it('creates a property link after dragging to a compatible row', () => {
    render(<PickWhipHarness />)
    const sourceRow = screen.getByTestId('source-row')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => sourceRow),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 9,
      clientX: 0,
      clientY: 0,
    })
    expect(screen.getByTestId('active-pick-whip')).toBeTruthy()

    fireEvent.pointerMove(window, { pointerId: 9, clientX: 24, clientY: 24 })
    expect(sourceRow.getAttribute('data-expression-link-hover')).toBe('true')
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 24, clientY: 24 })

    expect(useKeyframesStore.getState().keyframesByItemId.target?.expressions).toEqual([
      {
        type: 'link',
        targetProperty: 'x',
        sourceItemId: 'source',
        sourceProperty: 'y',
        enabled: true,
        timeOffsetFrames: 0,
      },
    ])
    expect(sourceRow.hasAttribute('data-expression-link-hover')).toBe(false)
    expect(screen.queryByTestId('active-pick-whip')).toBeNull()
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('accepts Shape scalar rows as link sources', () => {
    render(<PickWhipHarness />)
    const sourceRow = screen.getByTestId('shape-source-row')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => sourceRow),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Target X' }), {
      button: 0,
      pointerId: 10,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 24, clientY: 24 })
    fireEvent.pointerUp(window, { pointerId: 10, clientX: 24, clientY: 24 })

    expect(useKeyframesStore.getState().keyframesByItemId.target?.expressions?.[0]).toMatchObject({
      targetProperty: 'x',
      sourceItemId: 'shape-source',
      sourceProperty: 'trimPathEnd',
    })
    Reflect.deleteProperty(document, 'elementFromPoint')
  })

  it('keeps the cable anchored to its pick whip while the editor scrolls', async () => {
    render(<PickWhipHarness />)
    const button = screen.getByRole('button', { name: 'Target X' })
    const scrollArea = screen.getByTestId('motion-layer-scroll-area')
    let top = 20
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left: 10,
          top,
          width: 12,
          height: 12,
          right: 22,
          bottom: top + 12,
          x: 10,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    vi.spyOn(scrollArea, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left: 4,
          top: 12,
          width: 500,
          height: 300,
          right: 504,
          bottom: 312,
          x: 4,
          y: 12,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => null),
    })

    fireEvent.pointerDown(button, {
      button: 0,
      pointerId: 11,
      clientX: 16,
      clientY: 26,
    })
    expect(screen.getByTestId('active-pick-whip').dataset.startY).toBe('26')
    expect(screen.getByTestId('active-pick-whip').dataset.clipTop).toBe('12')
    expect(screen.getByTestId('active-pick-whip').dataset.clipBottom).toBe('312')

    top = 68
    fireEvent.scroll(button.parentElement!)

    await waitFor(() => {
      expect(screen.getByTestId('active-pick-whip').dataset.startY).toBe('74')
    })
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 16, clientY: 26 })
    Reflect.deleteProperty(document, 'elementFromPoint')
  })
})
