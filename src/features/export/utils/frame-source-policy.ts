export type RenderMode = 'export' | 'preview'

export type PreviewMediabunnyInitAction =
  | 'none'
  | 'warm-background-and-continue'
  | 'warm-background-and-skip'

export interface PreviewDomVideoDrawDecision {
  hasReadyDomVideo: boolean
  shouldDraw: boolean
  drift: number | null
  driftThreshold: number | null
}

export interface ResolvePreviewDomVideoDrawDecisionOptions {
  domVideo: HTMLVideoElement | null
  sourceTime: number
  speed: number
  isRenderingTransition: boolean
}

export interface ResolvePreviewMediabunnyInitActionOptions {
  renderMode: RenderMode
  hasMediabunny: boolean
  isMediabunnyDisabled: boolean
  hasEnsureVideoItemReady: boolean
  speed: number
}

export interface PreviewStrictWaitingFallbackOptions {
  renderMode: RenderMode
  hasMediabunny: boolean
  hasFallbackVideoElement: boolean
}

export interface PreviewWorkerBitmapOptions {
  renderMode: RenderMode
  hasReadyDomVideo: boolean
}

export interface PreviewVideoElementFallbackOptions {
  renderMode: RenderMode
  hasFallbackVideoElement: boolean
  hasMediabunny: boolean
  isMediabunnyDisabled: boolean
  mediabunnyFailedThisFrame: boolean
}

export interface PreviewGpuEffectFrameHoldOptions {
  domVideo: HTMLVideoElement | null
  sourceTime: number
  speed: number
  isRenderingTransition: boolean
  currentFrame: number
  cachedFrame: number
  hasCachedFrame: boolean
  fps: number
}

export function isVariableSpeedPlayback(speed: number): boolean {
  return Math.abs(speed - 1) >= 0.01
}

export function getPreviewDomVideoDriftThreshold(speed: number, isInTransition: boolean): number {
  const baseDriftThreshold = isInTransition ? 1.0 : 0.2
  return Math.abs(speed) > 1.01
    ? Math.max(baseDriftThreshold, 0.5 * Math.abs(speed))
    : baseDriftThreshold
}

export function resolvePreviewDomVideoDrawDecision(
  options: ResolvePreviewDomVideoDrawDecisionOptions,
): PreviewDomVideoDrawDecision {
  const { domVideo, sourceTime, speed, isRenderingTransition } = options

  if (!domVideo || domVideo.readyState < 2 || domVideo.videoWidth <= 0) {
    return {
      hasReadyDomVideo: false,
      shouldDraw: false,
      drift: null,
      driftThreshold: null,
    }
  }

  const drift = Math.abs(domVideo.currentTime - sourceTime)
  const driftThreshold = getPreviewDomVideoDriftThreshold(
    speed,
    isRenderingTransition || domVideo.dataset.transitionHold === '1',
  )

  return {
    hasReadyDomVideo: true,
    shouldDraw: drift <= driftThreshold,
    drift,
    driftThreshold,
  }
}

/**
 * Chromium can briefly demote a playing video below HAVE_CURRENT_DATA while
 * retaining its dimensions, last presented frame, and an accurate currentTime.
 * GPU effects can safely keep presenting their previous output for that short
 * gap instead of flashing through the decode fallback.
 */
export function shouldHoldPreviewGpuEffectFrame(
  options: PreviewGpuEffectFrameHoldOptions,
): boolean {
  const {
    domVideo,
    sourceTime,
    speed,
    isRenderingTransition,
    currentFrame,
    cachedFrame,
    hasCachedFrame,
    fps,
  } = options
  if (
    !domVideo ||
    domVideo.readyState >= 2 ||
    domVideo.videoWidth <= 0 ||
    !isPreviewGpuEffectFrameHoldFresh({
      currentFrame,
      cachedFrame,
      hasCachedFrame,
      fps,
    })
  ) {
    return false
  }

  const driftThreshold = getPreviewDomVideoDriftThreshold(
    speed,
    isRenderingTransition || domVideo.dataset.transitionHold === '1',
  )
  return Math.abs(domVideo.currentTime - sourceTime) <= driftThreshold
}

export function isPreviewGpuEffectFrameHoldFresh(options: {
  currentFrame: number
  cachedFrame: number
  hasCachedFrame: boolean
  fps: number
}): boolean {
  const { currentFrame, cachedFrame, hasCachedFrame, fps } = options
  const maxHoldFrames = Math.max(3, Math.ceil(fps))
  return hasCachedFrame && Math.abs(currentFrame - cachedFrame) <= maxHoldFrames
}

export function resolvePreviewMediabunnyInitAction(
  options: ResolvePreviewMediabunnyInitActionOptions,
): PreviewMediabunnyInitAction {
  const { renderMode, hasMediabunny, isMediabunnyDisabled, hasEnsureVideoItemReady, speed } =
    options

  if (
    renderMode !== 'preview' ||
    hasMediabunny ||
    isMediabunnyDisabled ||
    !hasEnsureVideoItemReady
  ) {
    return 'none'
  }

  return isVariableSpeedPlayback(speed)
    ? 'warm-background-and-skip'
    : 'warm-background-and-continue'
}

export function shouldUsePreviewStrictWaitingFallback(
  options: PreviewStrictWaitingFallbackOptions,
): boolean {
  const { renderMode, hasMediabunny, hasFallbackVideoElement } = options
  return renderMode === 'preview' && !hasMediabunny && !hasFallbackVideoElement
}

export function shouldTryPreviewWorkerBitmap(options: PreviewWorkerBitmapOptions): boolean {
  const { renderMode, hasReadyDomVideo } = options
  return renderMode === 'preview' && !hasReadyDomVideo
}

export function shouldAllowPreviewVideoElementFallback(
  options: PreviewVideoElementFallbackOptions,
): boolean {
  const {
    renderMode,
    hasFallbackVideoElement,
    hasMediabunny,
    isMediabunnyDisabled,
    mediabunnyFailedThisFrame,
  } = options

  return (
    renderMode === 'preview' &&
    hasFallbackVideoElement &&
    (mediabunnyFailedThisFrame || !hasMediabunny || isMediabunnyDisabled)
  )
}
