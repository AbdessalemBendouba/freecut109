import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useSequencesStore } from './sequences-store'
import { useCompositionsStore } from './compositions-store'
import { useCompositionNavigationStore, getActiveTabId } from './composition-navigation-store'
import { createSequence } from './actions/composition-actions'

describe('createSequence registers a visible tab', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([])
    useSequencesStore.getState().reset()
  })

  afterEach(() => resetTimelineCompositionTestState())

  it('adds the new sequence to the tab set and switches to it', () => {
    const id = createSequence('Sequence 1')

    // The whole point of the screenshot bug: it must be a registered tab.
    expect(useSequencesStore.getState().topLevelSequenceIds).toContain(id)
    // And the composition must resolve so the tab chip renders.
    expect(useCompositionsStore.getState().compositionById[id]).toBeDefined()

    const nav = useCompositionNavigationStore.getState()
    expect(nav.activeCompositionId).toBe(id)
    expect(getActiveTabId(nav.breadcrumbs)).toBe(id)
  })
})
