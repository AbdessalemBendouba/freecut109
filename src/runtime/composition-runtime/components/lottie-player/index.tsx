import React, { useEffect, useRef, useState } from 'react'
import { AbsoluteFill, useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useVideoConfig } from '../../hooks/use-player-compat'
import {
  LottieRenderer,
  mapTimelineFrameToLottieFrame,
} from '@/infrastructure/lottie/lottie-frame-provider'
import type { LottieItem } from '@/types/timeline'

interface LottiePlayerProps {
  item: LottieItem
}

/**
 * Renders a Lottie animation synced to the timeline frame.
 *
 * dotlottie-web renders the requested frame synchronously into the canvas, so
 * (unlike the GIF player) there is no frame pre-extraction — we just seek on
 * every `localFrame` change. The canvas is sized to the animation's native
 * resolution and CSS-stretched; the surrounding ItemVisualWrapper handles fit.
 */
export const LottiePlayer: React.FC<LottiePlayerProps> = ({ item }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<LottieRenderer | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const sequenceContext = useSequenceContext()
  const localFrame = sequenceContext?.localFrame ?? 0
  const { fps } = useVideoConfig()

  // (Re)create the renderer when the source changes. autoResize lets dotlottie
  // size its render target to the displayed canvas (crisp on clip resize).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !item.src) return

    setLoaded(false)
    setFailed(false)

    const renderer = new LottieRenderer({ canvas, src: item.src, autoResize: true })
    rendererRef.current = renderer

    let cancelled = false
    renderer.ready.then(() => {
      if (cancelled) return
      if (renderer.isLoaded) setLoaded(true)
      else setFailed(true)
    })

    return () => {
      cancelled = true
      renderer.destroy()
      rendererRef.current = null
    }
  }, [item.src])

  // Seek to the frame for the current timeline position.
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !loaded) return
    const lottieFrame = mapTimelineFrameToLottieFrame({
      localFrame,
      projectFps: fps,
      speed: item.speed ?? 1,
      totalFrames: item.totalFrames,
      frameRate: item.frameRate,
      loop: item.loop ?? true,
    })
    renderer.renderFrame(lottieFrame)
  }, [localFrame, loaded, fps, item.speed, item.totalFrames, item.frameRate, item.loop])

  if (failed) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: '#ff6b6b', fontSize: 14 }}>Lottie load failed</span>
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </AbsoluteFill>
  )
}
