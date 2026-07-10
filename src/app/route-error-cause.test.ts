// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'

import { getStorageFailureName } from './route-error-cause'

describe('getStorageFailureName', () => {
  // The whole point of attaching `cause` in workspace-fs: the DOMException name
  // is the diagnosis, and it reaches the screen only through this unwrapping.
  it('unwraps the DOMException name from a re-thrown Error cause', () => {
    const underlying = new DOMException('nope', 'NotSupportedError')
    const wrapped = new Error('Failed to load projects from workspace', { cause: underlying })

    expect(getStorageFailureName(wrapped)).toBe('NotSupportedError')
  })

  it('reads a DOMException thrown directly, without a wrapper', () => {
    expect(getStorageFailureName(new DOMException('denied', 'NotAllowedError'))).toBe(
      'NotAllowedError',
    )
  })

  // A plain cause must not be mistaken for a storage fault — that would offer
  // the user a "choose a different folder" button for an unrelated failure.
  it('returns null for an Error whose cause is not a DOMException', () => {
    expect(getStorageFailureName(new Error('boom', { cause: new Error('inner') }))).toBeNull()
    expect(getStorageFailureName(new Error('boom', { cause: 'NotAllowedError' }))).toBeNull()
  })

  it('returns null for an error with no cause, and for non-errors', () => {
    expect(getStorageFailureName(new Error('boom'))).toBeNull()
    expect(getStorageFailureName('NotAllowedError')).toBeNull()
    expect(getStorageFailureName(null)).toBeNull()
  })
})
