import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { CompositionItem, TextItem } from '@/types/timeline'
import { useCompositionsStore, useItemsStore } from '@/features/editor/deps/timeline-store'
import { CompositionControlsSection } from './composition-controls-section'

const sourceText: TextItem = {
  id: 'title',
  trackId: 'source-track',
  type: 'text',
  label: 'Headline',
  text: 'Original',
  color: '#ffffff',
  from: 0,
  durationInFrames: 30,
}

const instance: CompositionItem = {
  id: 'instance',
  trackId: 'parent-track',
  type: 'composition',
  label: 'Card',
  compositionId: 'card',
  compositionWidth: 1920,
  compositionHeight: 1080,
  from: 0,
  durationInFrames: 30,
}

describe('CompositionControlsSection', () => {
  beforeEach(() => {
    useCompositionsStore.getState().setCompositions([
      {
        id: 'card',
        name: 'Card',
        editorKind: 'composite-2d',
        items: [sourceText],
        tracks: [],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
        compositionControls: {
          version: 1,
          controls: [
            {
              id: 'headline',
              name: 'Headline',
              targetItemId: 'title',
              property: 'text.text',
              kind: 'text',
              defaultValue: 'Original',
            },
          ],
        },
      },
    ])
    useItemsStore.getState().setItems([instance])
  })

  it('edits and resets a value on only the selected composition instance', () => {
    const view = render(<CompositionControlsSection items={[instance]} />)

    const input = screen.getByRole('textbox', { name: 'Headline' })
    fireEvent.change(input, { target: { value: 'Launch day' } })
    fireEvent.blur(input)

    expect(useItemsStore.getState().itemById.instance).toMatchObject({
      compositionControlOverrides: { headline: 'Launch day' },
    })

    view.rerender(
      <CompositionControlsSection items={[useItemsStore.getState().itemById.instance!]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /reset all controls/i }))
    expect(
      (useItemsStore.getState().itemById.instance as CompositionItem).compositionControlOverrides,
    ).toBeUndefined()
  })
})
