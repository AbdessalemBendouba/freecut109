import { afterEach, describe, expect, it } from 'vitest'
import { useGizmoStore } from './gizmo-store'
import type { Transform } from '../types/gizmo'

const transform: Transform = {
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
}

describe('gizmo interaction ownership', () => {
  afterEach(() => {
    useGizmoStore.getState().cancelInteraction()
  })

  it('does not let deferred cleanup from an older drag clear the current drag', () => {
    const firstInteractionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 100, y: 100 }, transform, undefined, 'shape')
    const secondInteractionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 120, y: 120 }, transform, undefined, 'shape')

    useGizmoStore.getState().updateInteraction({ x: 150, y: 140 }, false)
    useGizmoStore.getState().clearInteraction(firstInteractionId)

    expect(useGizmoStore.getState().activeGizmo?.interactionId).toBe(secondInteractionId)
    expect(useGizmoStore.getState().previewTransform).not.toBeNull()

    useGizmoStore.getState().clearInteraction(secondInteractionId)

    expect(useGizmoStore.getState().activeGizmo).toBeNull()
    expect(useGizmoStore.getState().previewTransform).toBeNull()
  })
})
