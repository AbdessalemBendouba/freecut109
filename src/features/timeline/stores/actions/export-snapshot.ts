/**
 * Read-only snapshots of any timeline "sequence" (Main or a standalone
 * sequence tab) for the export dialog's sequence picker. Sourcing is done from
 * the registry + held-aside Main so the user can export a sequence *without*
 * switching the editor to it. Active live edits are reflected via the same
 * getEffectiveCompositions / getRootTimelineSnapshot helpers the persistence
 * paths use.
 */

import type { TimelineItem, TimelineTrack, ProjectMarker } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { ItemKeyframes } from '@/types/keyframe'
import type { AudioEqSettings } from '@/types/audio'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { DEFAULT_FPS } from '@/shared/timeline/defaults'
import { useMarkersStore } from '../markers-store'
import { useCompositionsStore } from '../compositions-store'
import { useSequencesStore } from '../sequences-store'
import { useCompositionNavigationStore, getActiveTabId } from '../composition-navigation-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useProjectStore } from '@/features/timeline/deps/projects'
import {
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  getRootTimelineSnapshot,
} from './shared'

export interface ExportableSequence {
  /** null = the Main timeline. */
  id: string | null
  name: string
  tracks: TimelineTrack[]
  items: TimelineItem[]
  transitions: Transition[]
  keyframes: ItemKeyframes[]
  fps: number
  width: number
  height: number
  backgroundColor?: string
  busAudioEq?: AudioEqSettings
  masterBusDb: number
  durationFrames: number
  inPoint: number | null
  outPoint: number | null
  markers: ProjectMarker[]
}

const MAIN_LABEL = 'Main Timeline'

function furthestItemEnd(items: TimelineItem[]): number {
  if (items.length === 0) return 0
  return Math.max(...items.map((item) => item.from + item.durationInFrames))
}

/** The active top-level tab (null = Main) — the picker's default selection. */
export function getActiveExportSequenceId(): string | null {
  return getActiveTabId(useCompositionNavigationStore.getState().breadcrumbs)
}

/** Main + every top-level sequence, in tab order, for the picker. */
export function listExportableSequences(): Array<{ id: string | null; name: string }> {
  const compositionById = useCompositionsStore.getState().compositionById
  const topLevelSequenceIds = useSequencesStore.getState().topLevelSequenceIds
  return [
    { id: null, name: MAIN_LABEL },
    ...topLevelSequenceIds.flatMap((id) => {
      const comp = compositionById[id]
      return comp ? [{ id, name: comp.name }] : []
    }),
  ]
}

/**
 * Build an export snapshot for a sequence (null = Main) reflecting the current
 * editor state, without navigating to it.
 */
export function getExportableSequence(sequenceId: string | null): ExportableSequence {
  const current = getCurrentTimelineSnapshot()
  const nav = useCompositionNavigationStore.getState()
  const activeTabId = getActiveTabId(nav.breadcrumbs)
  const playback = usePlaybackStore.getState()
  const markersState = useMarkersStore.getState()
  const isActiveTab = sequenceId === activeTabId

  // In/out: the live markers store holds the active tab's range; other tabs keep
  // theirs in the per-tab view map.
  const savedView = useSequencesStore.getState().getSequenceView(sequenceId ?? '__root__')
  const inPoint = isActiveTab ? markersState.inPoint : (savedView?.inPoint ?? null)
  const outPoint = isActiveTab ? markersState.outPoint : (savedView?.outPoint ?? null)

  if (sequenceId === null) {
    const root = getRootTimelineSnapshot(current)
    const metadata = useProjectStore.getState().currentProject?.metadata
    // Main's audio bus is live when Main is active, else held aside.
    const busAudioEq = activeTabId === null ? playback.busAudioEq : nav.mainHolder?.busAudioEq
    return {
      id: null,
      name: MAIN_LABEL,
      tracks: root.tracks,
      items: root.items,
      transitions: root.transitions,
      keyframes: root.keyframes,
      fps: metadata?.fps ?? DEFAULT_FPS,
      width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
      height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
      backgroundColor: metadata?.backgroundColor,
      busAudioEq,
      masterBusDb: playback.masterBusDb,
      durationFrames: furthestItemEnd(root.items),
      inPoint,
      outPoint,
      // Markers are never swapped per-tab, so the store always holds Main's.
      markers: markersState.markers,
    }
  }

  const comp = getEffectiveCompositions(current).find((c) => c.id === sequenceId)
  if (!comp) {
    // Sequence vanished (e.g. deleted mid-dialog) — fall back to Main.
    return getExportableSequence(null)
  }
  return {
    id: sequenceId,
    name: comp.name,
    tracks: comp.tracks,
    items: comp.items,
    transitions: comp.transitions ?? [],
    keyframes: comp.keyframes ?? [],
    fps: comp.fps,
    width: comp.width,
    height: comp.height,
    backgroundColor: comp.backgroundColor,
    busAudioEq: comp.busAudioEq,
    masterBusDb: playback.masterBusDb,
    durationFrames: comp.durationInFrames || furthestItemEnd(comp.items),
    inPoint,
    outPoint,
    // Standalone sequences don't carry their own project markers.
    markers: [],
  }
}
