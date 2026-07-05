import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useTimelineCommandStore } from './timeline-command-store'
import { useItemsStore } from './items-store'

/** Execute a change that actually mutates items so a history entry is recorded. */
function recordChange(itemId: string): void {
  useTimelineCommandStore.getState().execute({ type: 'TEST_ADD' }, () => {
    useItemsStore
      .getState()
      .setItems([...useItemsStore.getState().items, makeVideoItem({ id: itemId, trackId: 'track-v1' })])
  })
}

describe('timeline-command-store per-context history', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useTimelineCommandStore.getState().clearHistory()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('parks and restores per-context undo stacks on setActiveContext', () => {
    const cmd = useTimelineCommandStore

    // Record one entry in the root context.
    recordChange('root-1')
    expect(cmd.getState().undoStack).toHaveLength(1)
    expect(cmd.getState().canUndo).toBe(true)

    // Switching to a composition context parks root and starts empty.
    cmd.getState().setActiveContext('comp-a')
    expect(cmd.getState().undoStack).toHaveLength(0)
    expect(cmd.getState().canUndo).toBe(false)

    // Record two entries in comp-a's context.
    recordChange('a-1')
    recordChange('a-2')
    expect(cmd.getState().undoStack).toHaveLength(2)

    // Back to root: comp-a parked, root's single entry restored.
    cmd.getState().setActiveContext(null)
    expect(cmd.getState().undoStack).toHaveLength(1)
    expect(cmd.getState().canUndo).toBe(true)

    // Back to comp-a: its two entries are intact.
    cmd.getState().setActiveContext('comp-a')
    expect(cmd.getState().undoStack).toHaveLength(2)
  })

  it('clearHistory wipes every parked context', () => {
    const cmd = useTimelineCommandStore
    recordChange('root-1')
    cmd.getState().setActiveContext('comp-a')
    recordChange('a-1')

    cmd.getState().clearHistory()

    expect(cmd.getState().undoStack).toHaveLength(0)
    expect(cmd.getState().activeContextKey).toBe('__root__')

    // The previously-parked root context is gone too.
    cmd.getState().setActiveContext(null)
    expect(cmd.getState().undoStack).toHaveLength(0)
  })

  it('is a no-op when switching to the already-active context', () => {
    const cmd = useTimelineCommandStore
    recordChange('root-1')
    cmd.getState().setActiveContext(null) // already root
    expect(cmd.getState().undoStack).toHaveLength(1)
  })
})
