// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TFunction } from 'i18next'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import { getKeyframePropertyLabel, getKeyframePropertyShortLabel } from './property-i18n'

const t = ((_: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? '') as TFunction

describe('keyframe property labels', () => {
  it('uses a full path for tooltips and a parameter-only label beneath effect headers', () => {
    const property = buildEffectAnimatableProperty('gpu-color-wheels', 'wheels-1', 'exposure')

    expect(getKeyframePropertyLabel(t, property)).toBe('Color Wheels: Exposure')
    expect(getKeyframePropertyShortLabel(t, property)).toBe('Exposure')
  })
})
