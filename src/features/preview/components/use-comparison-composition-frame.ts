import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CompositionInputProps } from '@/types/export'
import {
  acquireComparisonCompositionRenderSession,
  type ComparisonCompositionRenderLease,
} from './comparison-composition-render-session'

interface UseComparisonCompositionFrameOptions {
  enabled: boolean
  sessionKey: string | null
  compositionId: string
  input: CompositionInputProps | null
  width: number
  height: number
  useProxyMedia: boolean
  frame: number
  displayCanvasRef: RefObject<HTMLCanvasElement | null>
  onError: (cancelled: boolean, error: unknown) => void
}

export function useComparisonCompositionFrame({
  enabled,
  sessionKey,
  compositionId,
  input,
  width,
  height,
  useProxyMedia,
  frame,
  displayCanvasRef,
  onError,
}: UseComparisonCompositionFrameOptions): boolean {
  const leaseRef = useRef<ComparisonCompositionRenderLease | null>(null)
  const lastPresentedFrameRef = useRef<number | null>(null)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled || !input || !sessionKey || typeof OffscreenCanvas === 'undefined') return

    const lease = acquireComparisonCompositionRenderSession({
      key: sessionKey,
      compositionId,
      input,
      width,
      height,
      useProxyMedia,
      priorityFrame: frameRef.current,
    })
    leaseRef.current = lease
    lastPresentedFrameRef.current = null
    setReady(false)

    return () => {
      lease.release()
      if (leaseRef.current === lease) leaseRef.current = null
    }
  }, [compositionId, enabled, height, input, sessionKey, useProxyMedia, width])

  useEffect(() => {
    if (!enabled || !sessionKey || lastPresentedFrameRef.current === frame) return
    const lease = leaseRef.current
    const display = displayCanvasRef.current
    if (!lease || !display) return

    let cancelled = false
    const controller = new AbortController()
    void lease
      .requestFrame(frame, display, controller.signal)
      .then((presented) => {
        if (cancelled || !presented) return
        lastPresentedFrameRef.current = frame
        setReady(true)
      })
      .catch((error) => onError(cancelled, error))

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [displayCanvasRef, enabled, frame, onError, sessionKey])

  return ready
}
