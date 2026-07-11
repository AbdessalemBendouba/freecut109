import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useCompositionsStore } from './compositions-store'
import { useCompositionNavigationStore } from './composition-navigation-store'
import { hydrateTimelineStoresFromProject } from './timeline-persistence'

const rootTrack = makeTimelineTrack({ id: 'root-track', name: 'Root', kind: 'video', order: 0 })
const motionTrack = makeTimelineTrack({
  id: 'motion-track',
  name: 'Motion',
  kind: 'video',
  order: 0,
})

describe('timeline project hydration', () => {
  beforeEach(() => resetTimelineCompositionTestState())
  afterEach(() => resetTimelineCompositionTestState())

  it('unwinds an active Motion composition before hydrating root stores', async () => {
    useItemsStore.getState().setTracks([rootTrack])
    useItemsStore
      .getState()
      .setItems([makeTimelineVideoItem({ id: 'stale-root', trackId: rootTrack.id })])
    useCompositionsStore.getState().addComposition({
      id: 'motion-comp',
      name: 'Motion composition',
      editorKind: 'composite-2d',
      tracks: [motionTrack],
      items: [makeTimelineVideoItem({ id: 'stale-motion', trackId: motionTrack.id })],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 300,
    })
    useCompositionNavigationStore.getState().switchToSequence('motion-comp')

    const project: Project = {
      id: 'project-1',
      name: 'Project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [rootTrack],
        items: [makeTimelineVideoItem({ id: 'project-root', trackId: rootTrack.id })],
        compositions: [
          {
            id: 'motion-comp',
            name: 'Motion composition',
            editorKind: 'composite-2d',
            tracks: [motionTrack],
            items: [
              makeTimelineVideoItem({ id: 'project-motion', trackId: motionTrack.id }),
            ],
            transitions: [],
            keyframes: [],
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 300,
          },
        ],
      },
    }

    await hydrateTimelineStoresFromProject(project)

    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['project-root'])
    expect(
      useCompositionsStore.getState().compositionById['motion-comp']?.items.map(
        (item) => item.id,
      ),
    ).toEqual(['project-motion'])
  })
})
