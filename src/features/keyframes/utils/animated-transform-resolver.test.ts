// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem, TimelineItem } from '@/types/timeline'
import {
  resolveAnimatedTransform,
  wouldCreateLinkedPropertyCycle,
} from './animated-transform-resolver'

describe('resolveAnimatedTransform', () => {
  it('interpolates anchor keyframes alongside the base transform', () => {
    const baseTransform = {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      anchorX: 160,
      anchorY: 90,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    const itemKeyframes: ItemKeyframes = {
      itemId: 'video-1',
      properties: [
        {
          property: 'anchorX',
          keyframes: [
            { id: 'ax-1', frame: 0, value: 40, easing: 'linear' },
            { id: 'ax-2', frame: 10, value: 140, easing: 'linear' },
          ],
        },
        {
          property: 'anchorY',
          keyframes: [
            { id: 'ay-1', frame: 0, value: 30, easing: 'linear' },
            { id: 'ay-2', frame: 10, value: 110, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = resolveAnimatedTransform(baseTransform, itemKeyframes, 5)

    expect(resolved.anchorX).toBe(90)
    expect(resolved.anchorY).toBe(70)
    expect(resolved.width).toBe(320)
    expect(resolved.height).toBe(180)
  })

  it('resolves linked properties at shared composition time', () => {
    const source: ShapeItem = {
      id: 'source',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 100,
      label: 'Source',
      transform: { x: 5 },
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
    }
    const target: TimelineItem = {
      ...source,
      id: 'target',
      from: 20,
      label: 'Target',
      transform: { x: -10 },
    }
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'source-x-1', frame: 0, value: 100, easing: 'linear' },
            { id: 'source-x-2', frame: 20, value: 300, easing: 'linear' },
          ],
        },
      ],
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'x',
          sourceItemId: source.id,
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const items = new Map([
      [source.id, source],
      [target.id, target],
    ])
    const keyframes = new Map([
      [source.id, sourceKeyframes],
      [target.id, targetKeyframes],
    ])

    const resolved = resolveAnimatedTransform(
      {
        x: -10,
        y: 0,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      5,
      {
        globalFrame: 25,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => items.get(itemId),
        getKeyframes: (itemId) => keyframes.get(itemId),
      },
    )

    // Composition frame 25 is source-relative frame 15, not target-relative 5.
    expect(resolved.x).toBe(250)
  })

  it('falls back to the authored value for broken references and cycles', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'target',
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'x',
          sourceItemId: 'missing',
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const base = {
      x: 42,
      y: 0,
      width: 100,
      height: 100,
      anchorX: 50,
      anchorY: 50,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    const resolved = resolveAnimatedTransform(base, itemKeyframes, 0, {
      globalFrame: 0,
      canvas: { width: 1920, height: 1080, fps: 30 },
      getItem: () => undefined,
      getKeyframes: (itemId) => (itemId === 'target' ? itemKeyframes : undefined),
    })

    expect(resolved.x).toBe(42)
  })

  it('resolves a transform property linked to a shape property', () => {
    const source: ShapeItem = {
      id: 'shape-source',
      type: 'shape',
      shapeType: 'path',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Shape source',
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
      trimPathStart: 35,
    }
    const target: TimelineItem = { ...source, id: 'shape-target', transform: { rotation: 5 } }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'rotation',
          sourceItemId: source.id,
          sourceProperty: 'trimPathStart',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }

    const resolved = resolveAnimatedTransform(
      {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 5,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      0,
      {
        globalFrame: 0,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => (itemId === source.id ? source : target),
        getKeyframes: (itemId) => (itemId === target.id ? targetKeyframes : undefined),
      },
    )

    expect(resolved.rotation).toBe(35)
  })

  it('detects direct and transitive dependency cycles', () => {
    const byItem: Record<string, ItemKeyframes> = {
      source: {
        itemId: 'source',
        properties: [],
        expressions: [
          {
            type: 'link',
            targetProperty: 'y',
            sourceItemId: 'middle',
            sourceProperty: 'rotation',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
      middle: {
        itemId: 'middle',
        properties: [],
        expressions: [
          {
            type: 'link',
            targetProperty: 'rotation',
            sourceItemId: 'target',
            sourceProperty: 'x',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    }

    expect(
      wouldCreateLinkedPropertyCycle('target', 'x', 'target', 'x', (itemId) => byItem[itemId]),
    ).toBe(true)
    expect(
      wouldCreateLinkedPropertyCycle('target', 'x', 'source', 'y', (itemId) => byItem[itemId]),
    ).toBe(true)
    expect(
      wouldCreateLinkedPropertyCycle('target', 'x', 'source', 'x', (itemId) => byItem[itemId]),
    ).toBe(false)
  })
})
