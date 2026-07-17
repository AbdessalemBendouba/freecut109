import { useCallback, useEffect, useRef } from 'react'

/**
 * Limits high-frequency input (wheel, pointer move) to one React update per
 * painted frame while always committing the newest value.
 */
export function useRafCoalescedValue<T>(onValue: (value: T) => void) {
  const onValueRef = useRef(onValue)
  const pendingRef = useRef<T | null>(null)
  const rafIdRef = useRef<number | null>(null)

  onValueRef.current = onValue

  const flush = useCallback(() => {
    rafIdRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending !== null) onValueRef.current(pending)
  }, [])

  const queue = useCallback(
    (value: T) => {
      pendingRef.current = value
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flush)
      }
    },
    [flush],
  )

  const flushNow = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    flush()
  }, [flush])

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    },
    [],
  )

  return { queue, flushNow }
}
