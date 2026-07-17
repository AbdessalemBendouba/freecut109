import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useKeyframesStore, useTimelineCommandStore } from '@/features/editor/deps/timeline-motion'
import { useLinkedTransformPickWhip } from './use-linked-transform-pick-whip'

function PickWhipHarness() {
  const { drag, begin } = useLinkedTransformPickWhip()
  return (
    <>
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
      {drag ? <span data-testid="active-pick-whip" /> : null}
    </>
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
})
