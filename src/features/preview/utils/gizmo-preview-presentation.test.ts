import { describe, expect, it } from 'vitest'
import { shouldPreferDomPlayerForGizmo } from './gizmo-preview-presentation'

describe('shouldPreferDomPlayerForGizmo', () => {
  it.each(['text', 'shape'] as const)(
    'uses the live DOM player for %s gizmo previews',
    (itemType) => {
      expect(shouldPreferDomPlayerForGizmo(false, itemType)).toBe(true)
    },
  )

  it('keeps vector drags on the DOM path when effects force the resting overlay', () => {
    expect(shouldPreferDomPlayerForGizmo(true, 'shape')).toBe(true)
  })

  it('does not change presentation for media gizmos', () => {
    expect(shouldPreferDomPlayerForGizmo(false, 'video')).toBe(false)
  })
})
