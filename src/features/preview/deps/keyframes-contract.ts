/**
 * Adapter exports for keyframes dependencies.
 * Preview modules should import keyframe hooks/utilities from here.
 */

export { useAnimatedTransform } from '@/features/keyframes/hooks/use-animated-transform'
export {
  getAutoKeyframeOperation,
  getVectorAutoKeyframeOperation,
  GIZMO_ANIMATABLE_PROPS,
  type AutoKeyframeOperation,
} from '@/features/keyframes/utils/auto-keyframe'
export {
  removeMotionAnimationLayers,
} from '@/features/keyframes/utils/motion-layer-eval'
export { removeMotionModifiers } from '@/features/keyframes/utils/motion-modifier-eval'
export { isFrameInTransitionRegion } from '@/features/keyframes/utils/transition-region'
export { resolveAnimatedTextItem } from '@/features/keyframes/utils/animated-text-item'
