import { describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@testing-library/react'
import { VideoConfigProvider } from '@/runtime/composition-runtime/deps/player'
import type { ControllerItem } from '@/types/timeline'
import { ItemContent } from './item-content'

describe('ItemContent', () => {
  it('accepts a Null Object controller without rendering pixels', () => {
    const controller: ControllerItem = {
      id: 'null-1',
      type: 'controller',
      controllerKind: 'null',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 30,
      label: 'Null Object',
      transform: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        aspectRatioLocked: true,
        cornerRadius: 0,
      },
      speed: 1,
    }

    const { container } = render(
      <VideoConfigProvider fps={30} width={1920} height={1080} durationInFrames={30}>
        <ItemContent item={controller} renderCompositionContent={vi.fn()} />
      </VideoConfigProvider>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
