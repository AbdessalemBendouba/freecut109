import { z } from 'zod'

export const HEADLESS_API_VERSION = 1

const id = z.string().min(1)
const finite = z.number().finite()
const frame = z.number().int().nonnegative()
const positiveFrames = z.number().int().positive()
const projectObject = z.record(z.string(), z.unknown())
const params = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]))

export const GPU_EFFECT_TYPES = [
  'gpu-ascii',
  'gpu-block-glitch',
  'gpu-blocks',
  'gpu-box-blur',
  'gpu-brightness',
  'gpu-bulge',
  'gpu-chroma-key',
  'gpu-color-glitch',
  'gpu-color-wheels',
  'gpu-contrast',
  'gpu-crt',
  'gpu-curves',
  'gpu-dither',
  'gpu-droste',
  'gpu-edge-detect',
  'gpu-exposure',
  'gpu-fluted-glass',
  'gpu-gaussian-blur',
  'gpu-glass-mosaic',
  'gpu-glow',
  'gpu-gradient-map',
  'gpu-grain',
  'gpu-grayscale',
  'gpu-halftone',
  'gpu-hue-shift',
  'gpu-ink',
  'gpu-invert',
  'gpu-kaleidoscope',
  'gpu-levels',
  'gpu-lut',
  'gpu-mirror',
  'gpu-motion-blur',
  'gpu-pixelate',
  'gpu-pixel-sort',
  'gpu-pixel-sort-hq',
  'gpu-posterize',
  'gpu-power-window',
  'gpu-radial-blur',
  'gpu-rgb-split',
  'gpu-ripple-glass',
  'gpu-saturation',
  'gpu-scanlines',
  'gpu-secondary-qualifier',
  'gpu-sepia',
  'gpu-sharpen',
  'gpu-temperature',
  'gpu-threshold',
  'gpu-trigger-wave',
  'gpu-twirl',
  'gpu-vhs',
  'gpu-vibrance',
  'gpu-vignette',
  'gpu-wave',
  'gpu-zoom-blur',
]

export const ANIMATABLE_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'volume',
  'textStyleScale',
  'fontSize',
  'lineHeight',
  'textPadding',
  'backgroundRadius',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
]
const animatableProperty = z.union([
  z.enum(ANIMATABLE_PROPERTIES),
  z.string().regex(/^effect:[^:]+:[^:]+:[^:]+$/, 'invalid effect keyframe property'),
])
const easing = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
  'cubic-bezier',
  'spring',
])
const transform = z
  .object({
    x: finite.optional(),
    y: finite.optional(),
    width: finite.positive().optional(),
    height: finite.positive().optional(),
    anchorX: finite.optional(),
    anchorY: finite.optional(),
    rotation: finite.optional(),
    opacity: finite.min(0).max(1).optional(),
    cornerRadius: finite.nonnegative().optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    aspectRatioLocked: z.boolean().optional(),
  })
  .strict()
const effect = z
  .object({
    type: z.literal('gpu-effect'),
    gpuEffectType: z.enum(GPU_EFFECT_TYPES),
    params: params.default({}),
  })
  .strict()

const opSchemas = [
  z
    .object({
      op: z.literal('addText'),
      id: id.optional(),
      text: z.string().optional(),
      from: frame.optional(),
      durationInFrames: positiveFrames.optional(),
      trackId: id.optional(),
      label: z.string().optional(),
      color: z.string().optional(),
      fontSize: finite.positive().optional(),
      fontFamily: z.string().min(1).optional(),
      fontWeight: z.enum(['medium', 'semibold', 'bold']).optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addItem'),
      item: z
        .object({
          type: id,
          trackId: id,
          from: frame,
          durationInFrames: positiveFrames,
          id: id.optional(),
        })
        .passthrough(),
    })
    .strict(),
  z
    .object({
      op: z.literal('updateItem'),
      id,
      updates: z
        .record(z.string(), z.unknown())
        .refine((value) => Object.keys(value).length > 0, 'updates must not be empty'),
    })
    .strict(),
  z.object({ op: z.literal('moveItem'), id, from: frame, trackId: id.optional() }).strict(),
  z.object({ op: z.literal('removeItems'), ids: z.array(id).min(1) }).strict(),
  z.object({ op: z.literal('split'), id, frame }).strict(),
  z.object({ op: z.literal('trimStart'), id, amount: positiveFrames }).strict(),
  z.object({ op: z.literal('trimEnd'), id, amount: positiveFrames }).strict(),
  z
    .object({
      op: z.literal('addTransition'),
      leftClipId: id,
      rightClipId: id,
      type: z.literal('crossfade').optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addTrack'),
      kind: z.enum(['video', 'audio']).optional(),
      order: finite.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addClip'),
      mediaId: id,
      from: frame.optional(),
      trackId: id.optional(),
      durationInFrames: positiveFrames.optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('addKeyframe'),
      itemId: id,
      property: animatableProperty,
      frame,
      value: finite,
      easing: easing.optional(),
    })
    .strict(),
  z.object({ op: z.literal('removeKeyframes'), itemId: id, property: animatableProperty }).strict(),
  z.union([
    z.object({ op: z.literal('addEffect'), itemId: id, effect }).strict(),
    z
      .object({
        op: z.literal('addEffect'),
        itemId: id,
        gpuEffectType: z.enum(GPU_EFFECT_TYPES),
        params: params.optional(),
      })
      .strict(),
  ]),
  z.object({ op: z.literal('removeEffect'), itemId: id, effectId: id }).strict(),
  z
    .object({
      op: z.literal('setTransform'),
      id,
      transform: transform.refine(
        (value) => Object.keys(value).length > 0,
        'transform must not be empty',
      ),
    })
    .strict(),
]

export const EDIT_OPERATION_NAMES = [
  'addText',
  'addItem',
  'updateItem',
  'moveItem',
  'removeItems',
  'split',
  'trimStart',
  'trimEnd',
  'addTransition',
  'addTrack',
  'addClip',
  'addKeyframe',
  'removeKeyframes',
  'addEffect',
  'removeEffect',
  'setTransform',
]
export const EDIT_OPERATION_DESCRIPTIONS = Object.fromEntries(
  EDIT_OPERATION_NAMES.map((name) => [name, samplesDescription(name)]),
)

function samplesDescription(name) {
  const descriptions = {
    addText: 'Add a text item',
    addItem: 'Add a complete timeline item',
    updateItem: 'Update an existing item',
    moveItem: 'Move an existing item',
    removeItems: 'Remove existing items atomically',
    split: 'Split an item at a frame',
    trimStart: 'Trim frames from an item start',
    trimEnd: 'Trim frames from an item end',
    addTransition: 'Add a transition between clips',
    addTrack: 'Add a video or audio track',
    addClip: 'Add workspace media as a clip',
    addKeyframe: 'Add a property keyframe',
    removeKeyframes: 'Remove keyframes for a property',
    addEffect: 'Add a registered GPU effect',
    removeEffect: 'Remove an existing item effect',
    setTransform: 'Update an item transform',
  }
  return descriptions[name]
}
export const editOpSchema = z.union(opSchemas)
export const editRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    ops: z.array(editOpSchema).min(1),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })

export const RENDER_OPTIONS = {
  codecs: ['h264', 'h265', 'vp9', 'vp8', 'av1'],
  containers: ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a'],
  qualities: ['low', 'medium', 'high', 'ultra'],
}
export const renderRequestSchema = z
  .object({
    project: id.optional(),
    projectObject: projectObject.optional(),
    out: id.optional(),
    codec: z.enum(RENDER_OPTIONS.codecs).optional(),
    container: z.enum(RENDER_OPTIONS.containers).optional(),
    resolution: z
      .string()
      .regex(/^(\d{1,5})x(\d{1,5})$/)
      .refine((value) => {
        const [w, h] = value.split('x').map(Number)
        return w >= 16 && h >= 16 && w <= 16384 && h <= 16384
      }, 'resolution dimensions must be between 16 and 16384')
      .optional(),
    fps: finite.min(1).max(240).optional(),
    quality: z.enum(RENDER_OPTIONS.qualities).optional(),
    inSec: finite.nonnegative().optional(),
    outSec: finite.positive().optional(),
    duration: finite.positive().optional(),
    audioOnly: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.project) !== Boolean(v.projectObject), {
    message: 'provide exactly one of project or projectObject',
    path: ['project'],
  })
  .refine((v) => !(v.outSec !== undefined && v.duration !== undefined), {
    message: 'outSec and duration are mutually exclusive',
    path: ['outSec'],
  })
  .refine((v) => v.outSec === undefined || v.outSec > (v.inSec ?? 0), {
    message: 'outSec must be greater than inSec',
    path: ['outSec'],
  })
  .refine((v) => !v.audioOnly || !v.container || ['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audioOnly requires an audio container',
    path: ['container'],
  })
  .refine((v) => v.audioOnly || !v.container || !['mp3', 'wav', 'm4a'].includes(v.container), {
    message: 'audio containers require audioOnly',
    path: ['container'],
  })

export function normalizeRenderInput(value) {
  const out = { ...value }
  if (out.in !== undefined) out.inSec = Number(out.in)
  if (out['out-sec'] !== undefined) out.outSec = Number(out['out-sec'])
  if (out['audio-only'] !== undefined) out.audioOnly = Boolean(out['audio-only'])
  delete out.in
  delete out['out-sec']
  delete out['audio-only']
  for (const key of ['fps', 'duration']) if (out[key] !== undefined) out[key] = Number(out[key])
  return out
}

export class ContractValidationError extends Error {
  constructor(message, fields) {
    super(message)
    this.name = 'ContractValidationError'
    this.code = 'VALIDATION_ERROR'
    this.fields = fields
  }
}

export function validate(schema, value) {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const fields = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
    code: issue.code,
  }))
  throw new ContractValidationError('Request validation failed', fields)
}

export function capabilities() {
  return {
    apiVersion: HEADLESS_API_VERSION,
    operations: EDIT_OPERATION_NAMES,
    operationDescriptions: EDIT_OPERATION_DESCRIPTIONS,
    options: {
      ...RENDER_OPTIONS,
      gpuEffects: GPU_EFFECT_TYPES,
      animatableProperties: ANIMATABLE_PROPERTIES,
    },
    schemas: {
      render: z.toJSONSchema(renderRequestSchema, { target: 'draft-7' }),
      edit: z.toJSONSchema(editRequestSchema, { target: 'draft-7' }),
    },
  }
}
