import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { PropertyLinkPickWhipOverlay } from '@/features/editor/deps/timeline-motion'
import type {
  MotionPickWhipOverlaySnapshot,
  MotionPickWhipPresentation,
} from '@/shared/hooks/use-pick-whip-drag'

function createPresentation(
  initialSnapshot: MotionPickWhipOverlaySnapshot,
): MotionPickWhipPresentation {
  const listeners = new Set<(snapshot: MotionPickWhipOverlaySnapshot) => void>()
  const presentation: MotionPickWhipPresentation = {
    current: initialSnapshot,
    publish: (snapshot) => {
      presentation.current = snapshot
      for (const listener of listeners) listener(snapshot)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      listener(presentation.current)
      return () => listeners.delete(listener)
    },
  }
  return presentation
}

describe('PropertyLinkPickWhipOverlay', () => {
  it('clips the cable to the motion scroll viewport', () => {
    const snapshot: MotionPickWhipOverlaySnapshot = {
      startX: 40,
      startY: 80,
      currentX: 120,
      currentY: 20,
      valid: false,
      clipBounds: { left: 10, top: 50, right: 210, bottom: 350 },
    }
    render(
      <PropertyLinkPickWhipOverlay
        drag={{
          ...snapshot,
          sourceItemId: null,
          presentation: createPresentation(snapshot),
        }}
      />,
    )

    const overlay = screen.getByTestId('property-link-pick-whip')
    expect(overlay.getAttribute('viewBox')).toBe('10 50 200 300')
    expect(overlay).toHaveStyle({ left: '10px', top: '50px', width: '200px', height: '300px' })
  })
})
