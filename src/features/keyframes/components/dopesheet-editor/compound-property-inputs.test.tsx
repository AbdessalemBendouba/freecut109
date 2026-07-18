import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { CompoundPropertyInputs } from './compound-property-inputs'

describe('CompoundPropertyInputs', () => {
  it('commits changed axes on blur without authoring a new keyframe', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          onCommit,
        }}
      />,
    )

    const y = screen.getByLabelText('Position Y')
    fireEvent.change(y, { target: { value: '42' } })
    fireEvent.blur(y)

    expect(onCommit).toHaveBeenCalledWith('y', 42, { allowCreate: false })
  })

  it('only allows explicit Enter to create a keyframe', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Scale',
          value: { x: 100, y: 100 },
          unit: '%',
          onCommit,
        }}
      />,
    )

    const x = screen.getByLabelText('Scale X')
    fireEvent.change(x, { target: { value: '125' } })
    fireEvent.keyDown(x, { key: 'Enter' })

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('x', 125, { allowCreate: true })
  })

  it('allows blur creation only when auto-key is enabled', () => {
    const onCommit = vi.fn()
    render(
      <CompoundPropertyInputs
        config={{
          label: 'Position',
          value: { x: 10, y: 20 },
          unit: 'px',
          allowCreateOnBlur: true,
          onCommit,
        }}
      />,
    )

    const y = screen.getByLabelText('Position Y')
    fireEvent.change(y, { target: { value: '24' } })
    fireEvent.blur(y)

    expect(onCommit).toHaveBeenCalledWith('y', 24, { allowCreate: true })
  })
})
