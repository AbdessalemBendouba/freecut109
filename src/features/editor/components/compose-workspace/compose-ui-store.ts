import { create } from 'zustand'

interface ComposeUiState {
  expandedLayerIdsByComposition: Record<string, string[]>
  toggleLayerExpanded: (compositionId: string, itemId: string) => void
  pruneCompositionLayers: (compositionId: string, validItemIds: Iterable<string>) => void
}

export const useComposeUiStore = create<ComposeUiState>((set) => ({
  expandedLayerIdsByComposition: {},
  toggleLayerExpanded: (compositionId, itemId) =>
    set((state) => {
      const current = state.expandedLayerIdsByComposition[compositionId] ?? []
      const next = current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId]
      return {
        expandedLayerIdsByComposition: {
          ...state.expandedLayerIdsByComposition,
          [compositionId]: next,
        },
      }
    }),
  pruneCompositionLayers: (compositionId, validItemIds) =>
    set((state) => {
      const current = state.expandedLayerIdsByComposition[compositionId]
      if (!current) return state
      const valid = new Set(validItemIds)
      const next = current.filter((id) => valid.has(id))
      if (next.length === current.length) return state
      return {
        expandedLayerIdsByComposition: {
          ...state.expandedLayerIdsByComposition,
          [compositionId]: next,
        },
      }
    }),
}))
