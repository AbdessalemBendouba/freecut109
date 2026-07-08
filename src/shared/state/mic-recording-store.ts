import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AudioInputDevice } from '@/infrastructure/audio/mic-recorder'

/**
 * UI-facing state for the timeline microphone-voiceover recorder.
 *
 * The heavy lifting (mic acquisition, MediaRecorder, timeline commit) lives in
 * the recording controller; this store only holds render state so toolbar
 * controls, the level meter, and the timeline overlay can subscribe to exactly
 * what they need. Only `selectedDeviceId` is persisted.
 *
 * Lifecycle: `idle → requesting → recording ⇄ paused → finalizing → idle`.
 * `requesting` covers the `getUserMedia` permission prompt; `finalizing` covers
 * the OPFS write + timeline placement after Stop.
 */
export type MicRecordingStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finalizing'

interface MicRecordingState {
  status: MicRecordingStatus
  /** Elapsed recorded time in ms (excludes paused spans). */
  elapsedMs: number
  /** Current input level, RMS 0..1. */
  level: number
  devices: AudioInputDevice[]
  /** Persisted preferred device; may be stale — controller falls back to default. */
  selectedDeviceId: string | null
  /** Playhead frame captured when recording started (the clip's start frame). */
  recordStartFrame: number
  /** User-facing error message from the last failed attempt, if any. */
  error: string | null

  setStatus: (status: MicRecordingStatus) => void
  setElapsedMs: (elapsedMs: number) => void
  setLevel: (level: number) => void
  setDevices: (devices: AudioInputDevice[]) => void
  setSelectedDeviceId: (deviceId: string | null) => void
  setRecordStartFrame: (frame: number) => void
  setError: (error: string | null) => void
  /** Return to idle, clearing transient recording state (keeps device prefs). */
  reset: () => void
}

export const useMicRecordingStore = create<MicRecordingState>()(
  persist(
    (set) => ({
      status: 'idle',
      elapsedMs: 0,
      level: 0,
      devices: [],
      selectedDeviceId: null,
      recordStartFrame: 0,
      error: null,

      setStatus: (status) => set({ status }),
      setElapsedMs: (elapsedMs) => set({ elapsedMs }),
      setLevel: (level) => set({ level }),
      setDevices: (devices) => set({ devices }),
      setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
      setRecordStartFrame: (recordStartFrame) => set({ recordStartFrame }),
      setError: (error) => set({ error }),
      reset: () =>
        set({ status: 'idle', elapsedMs: 0, level: 0, recordStartFrame: 0, error: null }),
    }),
    {
      name: 'freecut-mic-recording',
      partialize: (state) => ({ selectedDeviceId: state.selectedDeviceId }),
    },
  ),
)

/** True when recording is actively capturing or paused (a session is open). */
export function isMicRecordingActive(status: MicRecordingStatus): boolean {
  return status === 'recording' || status === 'paused'
}
