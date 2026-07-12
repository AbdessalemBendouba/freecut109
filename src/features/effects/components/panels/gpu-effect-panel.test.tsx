import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import type { GpuEffect, ItemEffect } from '@/types/effects'
import { GpuEffectPanel } from './gpu-effect-panel'

const definition = getGpuEffect('gpu-fluted-glass')!

function makeProps() {
  const gpuEffect: GpuEffect = {
    type: 'gpu-effect',
    gpuEffectType: definition.id,
    params: {
      ...getGpuEffectDefaultParams(definition.id),
      shadows: 0.49,
    },
  }
  const effect: ItemEffect = { id: 'fluted-1', effect: gpuEffect, enabled: true }

  return {
    itemIds: ['clip-1'],
    effect,
    gpuEffect,
    definition,
    getKeyframeProperty: vi.fn(() => null),
    onParamChange: vi.fn(),
    onParamLiveChange: vi.fn(),
    onReset: vi.fn(),
    onToggle: vi.fn(),
    onRemove: vi.fn(),
  }
}

describe('GpuEffectPanel parameter resets', () => {
  it('keeps a reset control beside each visible parameter and restores its default', () => {
    const props = makeProps()
    render(<GpuEffectPanel {...props} />)

    expect(screen.getByRole('button', { name: /reset to defaults: back color/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /reset to defaults: shape/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /reset to defaults: shadows/i }))

    expect(props.onParamChange).toHaveBeenCalledWith(
      'fluted-1',
      'shadows',
      definition.params.shadows?.default,
    )
  })

  it('renders a distinct collapsible effect header without hiding its actions', () => {
    const props = makeProps()
    render(<GpuEffectPanel {...props} />)

    const disclosure = screen.getByRole('button', { name: /^Fluted Glass/ })
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(disclosure.parentElement).toHaveClass('bg-muted/35')

    fireEvent.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Modified from defaults')).toBeInTheDocument()
    expect(screen.queryByText('Back Color')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset to defaults$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove effect/i })).toBeInTheDocument()
  })
})
