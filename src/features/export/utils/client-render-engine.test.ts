import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { SubCompRenderData } from './canvas-item-renderer'
import {
  collectPriorityMediaItemIds,
  collectPriorityNestedVideoItemIds,
  resolveCompositionRendererExecutionPolicy,
  resolveRenderedFrameCacheMode,
  resolveVideoPreloadPlan,
  selectNestedMediaSource,
  selectRendererPreloadItems,
  selectPreviewVideoSource,
  subCompositionRenderDataHasGpuEffects,
} from './client-render-engine'

describe('comparison preview resource selection', () => {
  it('uses nested proxy media for preview consumers and source media otherwise', () => {
    expect(
      selectNestedMediaSource({
        useProxyMedia: true,
        proxyUrl: 'blob:proxy',
        sourceUrl: 'blob:source',
      }),
    ).toBe('blob:proxy')
    expect(
      selectNestedMediaSource({
        useProxyMedia: false,
        proxyUrl: 'blob:proxy',
        sourceUrl: 'blob:source',
      }),
    ).toBe('blob:source')
  })

  it('keeps comparison drawing isolated while enabling lazy worker-backed frames', () => {
    expect(resolveCompositionRendererExecutionPolicy('comparison')).toEqual({
      itemRenderMode: 'export',
      usesSharedPreviewPool: false,
      usesStrictPreviewDecode: false,
      allowsPredecodedVideoFrames: true,
    })
  })

  it('keeps only exact target dependencies in comparison preload batches', () => {
    const items = [{ id: 'target' }, { id: 'future' }]
    expect(
      selectRendererPreloadItems('comparison', items, new Set(['target']), (item) => item.id),
    ).toEqual([{ id: 'target' }])
    expect(
      selectRendererPreloadItems('export', items, new Set(['target']), (item) => item.id),
    ).toEqual(items)
  })
})

describe('collectPriorityNestedVideoItemIds', () => {
  it('initializes only video leaves visible at the mapped nested frame', () => {
    const rootWrapper = {
      id: 'root-wrapper',
      type: 'composition',
      trackId: 'root-track',
      from: 0,
      durationInFrames: 60,
      compositionId: 'outer',
      sourceStart: 10,
      sourceFps: 60,
      speed: 2,
    } as TimelineItem
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      trackId: 'outer-track',
      from: 20,
      durationInFrames: 60,
      compositionId: 'inner',
      sourceStart: 5,
      sourceFps: 30,
      speed: 1,
    } as TimelineItem
    const visibleVideo = {
      id: 'visible-video',
      type: 'video',
      trackId: 'inner-track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem
    const deferredVideo = {
      id: 'deferred-video',
      type: 'video',
      trackId: 'inner-track',
      from: 20,
      durationInFrames: 10,
    } as TimelineItem
    const hiddenVideo = {
      id: 'hidden-video',
      type: 'video',
      trackId: 'hidden-track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem

    expect(
      collectPriorityNestedVideoItemIds({
        tracks: [
          {
            id: 'root-track',
            name: 'Root',
            order: 0,
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [rootWrapper],
          },
        ],
        frame: 5,
        fps: 30,
        compositionById: {
          outer: {
            id: 'outer',
            name: 'Outer',
            fps: 60,
            width: 1920,
            height: 1080,
            durationInFrames: 120,
            items: [nestedWrapper],
            tracks: [
              {
                id: 'outer-track',
                name: 'Outer track',
                order: 0,
                height: 60,
                locked: false,
                visible: true,
                muted: false,
                solo: false,
                items: [nestedWrapper],
              },
            ],
            transitions: [],
            keyframes: [],
          },
          inner: {
            id: 'inner',
            name: 'Inner',
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 60,
            items: [visibleVideo, deferredVideo, hiddenVideo],
            tracks: [
              {
                id: 'inner-track',
                name: 'Visible',
                order: 0,
                height: 60,
                locked: false,
                visible: true,
                muted: false,
                solo: false,
                items: [visibleVideo, deferredVideo],
              },
              {
                id: 'hidden-track',
                name: 'Hidden',
                order: 1,
                height: 60,
                locked: false,
                visible: false,
                muted: false,
                solo: false,
                items: [hiddenVideo],
              },
            ],
            transitions: [],
            keyframes: [],
          },
        },
      }),
    ).toEqual(['visible-video'])
  })

  it('collects exact-frame image and Lottie leaves without unrelated media', () => {
    const visibleImage = {
      id: 'visible-image',
      type: 'image',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
    } as TimelineItem
    const visibleLottie = {
      id: 'visible-lottie',
      type: 'lottie',
      trackId: 'track',
      from: 0,
      durationInFrames: 10,
    } as TimelineItem
    const futureVideo = {
      id: 'future-video',
      type: 'video',
      trackId: 'track',
      from: 10,
      durationInFrames: 10,
    } as TimelineItem

    expect(
      collectPriorityMediaItemIds({
        tracks: [
          {
            id: 'track',
            name: 'Track',
            order: 0,
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [visibleImage, visibleLottie, futureVideo],
          },
        ],
        frame: 5,
        fps: 30,
        compositionById: {},
      }),
    ).toEqual({ video: [], image: ['visible-image'], lottie: ['visible-lottie'] })
  })
})

describe('selectPreviewVideoSource', () => {
  it('selects the cached proxy when a compound item still carries its original source', () => {
    const proxyBitmap = {} as ImageBitmap
    expect(
      selectPreviewVideoSource({
        candidates: ['blob:stored-original', 'blob:scrub-proxy'],
        sourceTime: 42,
        toleranceSeconds: 0.01,
        getCachedPredecodedBitmap: (src) => (src === 'blob:scrub-proxy' ? proxyBitmap : null),
      }),
    ).toBe('blob:scrub-proxy')
  })

  it('preserves composition source order when no scrub bitmap is cached', () => {
    expect(
      selectPreviewVideoSource({
        candidates: ['blob:composition-source', 'blob:registered-source'],
      }),
    ).toBe('blob:composition-source')
  })

  it('selects the scheduled compound proxy before its first bitmap arrives', () => {
    expect(
      selectPreviewVideoSource({
        candidates: ['blob:stored-original', 'blob:scrub-proxy'],
        sourceTime: 42,
        toleranceSeconds: 0.01,
        isActivePreviewSourceTarget: (src) => src === 'blob:scrub-proxy',
      }),
    ).toBe('blob:scrub-proxy')
  })
})

describe('resolveVideoPreloadPlan', () => {
  it('defers every non-priority source in preview mode', () => {
    expect(
      resolveVideoPreloadPlan('preview', ['active', 'nearby', 'far', 'far'], ['active', 'nearby']),
    ).toEqual({
      priorityItemIds: ['active', 'nearby'],
      eagerItemIds: [],
      deferredItemIds: ['far'],
    })
  })

  it('keeps export eager after initializing its priority sources first', () => {
    expect(resolveVideoPreloadPlan('export', ['active', 'nearby', 'far'], ['nearby'])).toEqual({
      priorityItemIds: ['nearby'],
      eagerItemIds: ['active', 'far'],
      deferredItemIds: [],
    })
  })

  it('keeps comparison sources isolated but defers every non-target decoder', () => {
    expect(resolveVideoPreloadPlan('comparison', ['target', 'future'], ['target'])).toEqual({
      priorityItemIds: ['target'],
      eagerItemIds: [],
      deferredItemIds: ['future'],
    })
  })
})

describe('resolveRenderedFrameCacheMode', () => {
  it('seeds the cache, keeps nearby scrub frames, and skips isolated overview seeks', () => {
    expect(resolveRenderedFrameCacheMode({ previousFrame: null, frame: 9000, fps: 30 })).toBe(
      'full',
    )
    expect(resolveRenderedFrameCacheMode({ previousFrame: 9000, frame: 8992, fps: 30 })).toBe(
      'full',
    )
    expect(resolveRenderedFrameCacheMode({ previousFrame: 9000, frame: 12000, fps: 30 })).toBe(
      'skip',
    )
  })

  it('uses only the GPU tier for sequential forward frames', () => {
    expect(resolveRenderedFrameCacheMode({ previousFrame: 100, frame: 101, fps: 30 })).toBe(
      'gpu-only',
    )
  })
})

function makeSubCompData(items: TimelineItem[]): SubCompRenderData {
  return {
    fps: 30,
    durationInFrames: 90,
    sortedTracks: [{ order: 0, visible: true, items }],
    keyframesMap: new Map(),
    adjustmentLayers: [],
  }
}

describe('subCompositionRenderDataHasGpuEffects', () => {
  it('detects GPU effects inside nested compound clips', () => {
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      compositionId: 'inner-comp',
    } as TimelineItem
    const innerVideo = {
      id: 'inner-video',
      type: 'video',
      effects: [
        {
          id: 'dither',
          enabled: true,
          effect: { type: 'gpu-effect', gpuEffectType: 'gpu-dither', params: {} },
        },
      ],
    } as TimelineItem
    const subCompRenderData = new Map<string, SubCompRenderData>([
      ['outer-comp', makeSubCompData([nestedWrapper])],
      ['inner-comp', makeSubCompData([innerVideo])],
    ])

    expect(subCompositionRenderDataHasGpuEffects('outer-comp', subCompRenderData)).toBe(true)
  })

  it('uses preview effect overrides while checking nested compounds', () => {
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      compositionId: 'inner-comp',
    } as TimelineItem
    const innerVideo = {
      id: 'inner-video',
      type: 'video',
      effects: [],
    } as unknown as TimelineItem
    const subCompRenderData = new Map<string, SubCompRenderData>([
      ['outer-comp', makeSubCompData([nestedWrapper])],
      ['inner-comp', makeSubCompData([innerVideo])],
    ])

    expect(
      subCompositionRenderDataHasGpuEffects('outer-comp', subCompRenderData, {
        getPreviewEffectsOverride: (itemId) =>
          itemId === 'inner-video'
            ? [
                {
                  id: 'preview-dither',
                  enabled: true,
                  effect: { type: 'gpu-effect', gpuEffectType: 'gpu-dither', params: {} },
                },
              ]
            : undefined,
      }),
    ).toBe(true)
  })
})
