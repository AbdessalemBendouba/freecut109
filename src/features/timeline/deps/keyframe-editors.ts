/**
 * Adapter exports for keyframe editor UI used by lazy timeline panels.
 */

export {
  DopesheetEditor,
  CompactNavigator,
  GROUP_HEADER_HEIGHT,
  KEYFRAME_EDGE_INSET,
  ROW_HEIGHT,
  getAnimatablePropertiesForItem,
  getEffectPropertyBaseValue,
  getProceduralBands,
  getPropertyAccordionGroups,
  getShapeAnimatableBaseValue,
  resolveAnimatedShapeItem,
  captureAnimationFromItem,
  getPresetCompatibility,
  buildBakeMotionPlan,
  wouldCreateLinkedPropertyCycle,
} from './keyframes-contract'
export type { PresetIncompatibilityReason, ProceduralPreviewInput } from './keyframes-contract'
