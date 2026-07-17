import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { LinkedTransformPickWhipOverlay } from './linked-transform-pick-whip-overlay'

describe('LinkedTransformPickWhipOverlay', () => {
  it('clips the cable to the motion scroll viewport', () => {
    render(
      <LinkedTransformPickWhipOverlay
        drag={{
          startX: 40,
          startY: 80,
          currentX: 120,
          currentY: 20,
          sourceItemId: null,
          clipBounds: { left: 10, top: 50, right: 210, bottom: 350 },
        }}
      />,
    )

    const overlay = screen.getByTestId('property-link-pick-whip')
    expect(overlay.getAttribute('viewBox')).toBe('10 50 200 300')
    expect(overlay).toHaveStyle({ left: '10px', top: '50px', width: '200px', height: '300px' })
  })
})
