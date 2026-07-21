import { afterEach, describe, expect, it, vi } from 'vitest'
import { suppressReleaseClick } from './gizmo-transform-interaction'

describe('suppressReleaseClick', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('consumes the click synthesized immediately after a drag release', () => {
    const backgroundClick = vi.fn()
    window.addEventListener('click', backgroundClick)

    suppressReleaseClick()
    const releaseClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    window.dispatchEvent(releaseClick)

    expect(releaseClick.defaultPrevented).toBe(true)
    expect(backgroundClick).not.toHaveBeenCalled()
    window.removeEventListener('click', backgroundClick)
  })

  it('does not consume a later explicit click', () => {
    vi.useFakeTimers()
    const backgroundClick = vi.fn()
    window.addEventListener('click', backgroundClick)

    suppressReleaseClick()
    vi.runAllTimers()
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(backgroundClick).toHaveBeenCalledOnce()
    window.removeEventListener('click', backgroundClick)
  })
})
