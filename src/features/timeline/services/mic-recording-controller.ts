/**
 * Microphone voiceover controller.
 *
 * A module-level singleton (like `blobUrlManager`) that wires the mic
 * {@link MicRecorder} engine to the transport and the timeline. Toolbar
 * controls call the exported functions directly; render state flows through
 * {@link useMicRecordingStore}.
 *
 * Sync model (see the recording design notes):
 * - Recording captures WHILE the timeline plays; the finished clip is anchored
 *   to the playhead frame at the moment capture began.
 * - The audio↔playhead mapping is kept strictly linear: the ONLY pause/resume
 *   is the explicit lockstep one (pauses recorder + transport together). Any
 *   OTHER transport stop (spacebar, reaching the end) finalizes the take, and
 *   seeking is blocked while recording — a seek would move the playhead without
 *   moving audio and break the mapping irreparably.
 * - Duration comes from `decodeAudioData` (sample-accurate); MediaRecorder
 *   blobs frequently report `Infinity`/`0`.
 */

import {
  MicRecorder,
  extensionForMimeType,
  enumerateAudioInputs,
  hasMicRecordingSupport,
  startMicLevelMonitor,
  type MicRecorderResult,
  type MicMonitorHandle,
} from '@/infrastructure/audio/mic-recorder'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useMicRecordingStore, isMicRecordingActive } from '@/shared/state/mic-recording-store'
import { createLogger } from '@/shared/logging/logger'
import { i18n } from '@/i18n'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { addItemOnNewTrack } from '../stores/actions/item-actions'
import { createClassicTrack } from '../utils/classic-tracks'
import { buildMediaTimelineItem } from '../utils/media-timeline-item-builder'
import { importMediaLibraryService } from '../deps/media-library-service'
import { useMediaLibraryStore } from '../deps/media-library-store'

const logger = createLogger('MicRecording')

/** Minimum ms between level-meter store writes (keeps re-render rate ~25fps). */
const LEVEL_THROTTLE_MS = 40

let recorder: MicRecorder | null = null
let monitor: MicMonitorHandle | null = null
let monitorToken = 0
let transportUnsub: (() => void) | null = null
let projectUnsub: (() => void) | null = null
let elapsedTimer: ReturnType<typeof setInterval> | null = null
/** Guards the transport watcher against our own intentional play/pause calls. */
let suppressTransport = false
/** When true, the timeline monitor was muted for this take and must be restored. */
let mutedByRecording = false
let lastLevelAt = 0

export function isMicRecordingSupported(): boolean {
  return hasMicRecordingSupport()
}

/**
 * Refresh the list of audio input devices. Labels are only populated once mic
 * permission has been granted, so call this again after the first successful
 * `start()`.
 */
export async function refreshMicDevices(): Promise<void> {
  try {
    const devices = await enumerateAudioInputs()
    const store = useMicRecordingStore.getState()
    store.setDevices(devices)
    if (store.selectedDeviceId && !devices.some((d) => d.deviceId === store.selectedDeviceId)) {
      store.setSelectedDeviceId(null)
    }
  } catch (error) {
    logger.warn('Failed to enumerate audio inputs', error)
  }
}

export async function startMicRecording(): Promise<void> {
  const store = useMicRecordingStore.getState()
  if (store.status !== 'idle') return

  if (!hasMicRecordingSupport()) {
    store.setError(i18n.t('recording.errors.unsupported'))
    return
  }

  const projectId = useMediaLibraryStore.getState().currentProjectId
  if (!projectId) {
    store.setError(i18n.t('recording.errors.noProject'))
    return
  }

  // Release the pre-record monitor stream (if the device picker opened one) so
  // it doesn't contend with the recording stream.
  stopMicMonitor()

  store.setError(null)
  store.setStatus('requesting')

  const rec = new MicRecorder()
  recorder = rec

  try {
    await rec.start({
      deviceId: store.selectedDeviceId ?? undefined,
      noiseSuppression: store.noiseSuppression,
      autoGainControl: store.autoGainControl,
      onLevel: handleLevel,
    })
  } catch (error) {
    rec.dispose()
    recorder = null
    store.setStatus('idle')
    store.setError(describeGetUserMediaError(error))
    return
  }

  // Labels become available after the permission grant — refresh so the picker
  // shows real device names next time.
  void refreshMicDevices()

  // Optionally silence the timeline monitor mix so speaker audio doesn't bleed
  // into the mic. Remembered so we can restore the user's prior mute state.
  mutedByRecording = false
  if (store.muteWhileRecording && !usePlaybackStore.getState().muted) {
    usePlaybackStore.getState().setMuted(true)
    mutedByRecording = true
  }

  // Anchor the clip to the playhead. Start (or continue) playback first so the
  // clock's auto-rewind-at-end has already resolved before we read the frame.
  const playback = usePlaybackStore.getState()
  let anchor = playback.currentFrame
  if (!playback.isPlaying) {
    const contentEnd = useItemsStore.getState().maxItemEndFrame
    if (contentEnd > 0 && anchor >= contentEnd) {
      // `Clock.play()` rewinds to the start when parked at the end; anchor there
      // too so the committed clip lands where the audio actually plays.
      anchor = 0
      playback.setCurrentFrame(0)
    }
    suppressTransport = true
    playback.play()
    suppressTransport = false
  }

  store.setRecordStartFrame(anchor)
  store.setElapsedMs(0)
  store.setStatus('recording')
  startElapsedTimer()
  watchTransport()
  watchProject()
}

/** Explicit lockstep pause: pauses the recorder and the transport together. */
export function pauseMicRecording(): void {
  const store = useMicRecordingStore.getState()
  if (store.status !== 'recording' || !recorder) return

  recorder.pause()
  suppressTransport = true
  usePlaybackStore.getState().pause()
  suppressTransport = false

  stopElapsedTimer()
  store.setElapsedMs(recorder.elapsedMs())
  store.setStatus('paused')
}

/** Resume from an explicit pause. */
export function resumeMicRecording(): void {
  const store = useMicRecordingStore.getState()
  if (store.status !== 'paused' || !recorder) return

  recorder.resume()
  suppressTransport = true
  usePlaybackStore.getState().play()
  suppressTransport = false

  startElapsedTimer()
  store.setStatus('recording')
}

/** Stop and commit the take to the timeline. */
export async function stopMicRecording(): Promise<void> {
  const store = useMicRecordingStore.getState()
  if (!isMicRecordingActive(store.status)) return

  transportUnsub?.()
  transportUnsub = null
  projectUnsub?.()
  projectUnsub = null
  stopElapsedTimer()

  suppressTransport = true
  usePlaybackStore.getState().pause()
  suppressTransport = false
  restoreMonitorMute()

  const rec = recorder
  recorder = null
  if (!rec) {
    store.reset()
    return
  }

  store.setStatus('finalizing')

  let result: MicRecorderResult
  try {
    result = await rec.stop()
  } catch (error) {
    logger.error('Failed to stop recording', error)
    rec.dispose()
    store.setError(i18n.t('recording.errors.failed'))
    store.reset()
    return
  }

  const anchor = store.recordStartFrame
  try {
    await commitRecording(result, anchor)
  } catch (error) {
    logger.error('Failed to save recording', error)
    store.setError(i18n.t('recording.errors.saveFailed'))
  } finally {
    store.reset()
  }
}

/** Discard the in-progress take without touching the timeline. */
export function cancelMicRecording(): void {
  transportUnsub?.()
  transportUnsub = null
  projectUnsub?.()
  projectUnsub = null
  stopElapsedTimer()

  suppressTransport = true
  usePlaybackStore.getState().pause()
  suppressTransport = false
  restoreMonitorMute()

  recorder?.dispose()
  recorder = null
  useMicRecordingStore.getState().reset()
}

// --- pre-record monitor ----------------------------------------------------

/**
 * Open a monitor-only mic stream so the device picker's level meter is live
 * before recording. No-op while a real take is active (that already meters).
 * Guarded by a token so out-of-order open/close calls can't leak a stream.
 */
export async function startMicMonitor(): Promise<void> {
  if (monitor || isMicRecordingActive(useMicRecordingStore.getState().status)) return
  const store = useMicRecordingStore.getState()
  const token = ++monitorToken
  try {
    const handle = await startMicLevelMonitor({
      deviceId: store.selectedDeviceId ?? undefined,
      noiseSuppression: store.noiseSuppression,
      autoGainControl: store.autoGainControl,
      onLevel: handleLevel,
    })
    // A newer stop()/restart superseded us while awaiting — release immediately.
    if (token !== monitorToken || isMicRecordingActive(useMicRecordingStore.getState().status)) {
      handle.stop()
      return
    }
    monitor = handle
  } catch (error) {
    logger.warn('Failed to start mic monitor', error)
  }
}

export function stopMicMonitor(): void {
  monitorToken += 1
  monitor?.stop()
  monitor = null
  useMicRecordingStore.getState().setLevel(0)
}

// --- internals -------------------------------------------------------------

function handleLevel(level: number): void {
  const now = performance.now()
  if (now - lastLevelAt < LEVEL_THROTTLE_MS) return
  lastLevelAt = now
  useMicRecordingStore.getState().setLevel(level)
}

function startElapsedTimer(): void {
  stopElapsedTimer()
  elapsedTimer = setInterval(() => {
    if (recorder) {
      useMicRecordingStore.getState().setElapsedMs(recorder.elapsedMs())
    }
  }, 100)
}

function stopElapsedTimer(): void {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

function watchTransport(): void {
  transportUnsub?.()
  transportUnsub = usePlaybackStore.subscribe((state, prev) => {
    if (state.isPlaying === prev.isPlaying) return
    if (suppressTransport) return
    if (state.isPlaying) return
    // Transport stopped by something other than our lockstep pause (spacebar,
    // reaching the timeline end): finalize the take so audio can't desync from
    // a playhead that keeps moving independently.
    if (useMicRecordingStore.getState().status === 'recording') {
      void stopMicRecording()
    }
  })
}

/**
 * Cancel the in-flight take if the active project changes mid-recording — the
 * take belongs to the project it started in, and its timeline/media targets are
 * about to be swapped out.
 */
function watchProject(): void {
  projectUnsub?.()
  const startProjectId = useMediaLibraryStore.getState().currentProjectId
  projectUnsub = useMediaLibraryStore.subscribe((state, prev) => {
    if (state.currentProjectId === prev.currentProjectId) return
    if (state.currentProjectId !== startProjectId) {
      cancelMicRecording()
    }
  })
}

/** Restore the timeline monitor mute state if we changed it for this take. */
function restoreMonitorMute(): void {
  if (!mutedByRecording) return
  mutedByRecording = false
  usePlaybackStore.getState().setMuted(false)
}

async function commitRecording(result: MicRecorderResult, anchor: number): Promise<void> {
  if (result.blob.size === 0) {
    throw new Error('Recording produced no audio')
  }
  const projectId = useMediaLibraryStore.getState().currentProjectId
  if (!projectId) {
    throw new Error('No project selected')
  }

  const extension = extensionForMimeType(result.mimeType)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const fileName = `${i18n.t('recording.fileNamePrefix')}-${stamp}.${extension}`
  const file = new File([result.blob], fileName, {
    type: result.mimeType || 'audio/webm',
    lastModified: Date.now(),
  })

  // The service resolves an authoritative, finite duration (probe → decode →
  // timer) once — reuse it here instead of decoding the blob a second time.
  const { mediaLibraryService } = await importMediaLibraryService()
  const media = await mediaLibraryService.importRecordedAudio(file, projectId, {
    fallbackDurationMs: result.durationMs,
  })

  const fps = useTimelineSettingsStore.getState().fps
  const durationSeconds = media.duration
  const durationInFrames = Math.max(1, Math.round(durationSeconds * fps))

  // Apply the user's manual input-latency compensation (clamped to keep the
  // clip on the timeline).
  const syncOffsetMs = useMicRecordingStore.getState().syncOffsetMs
  const from = Math.max(0, anchor + Math.round((syncOffsetMs / 1000) * fps))

  // We already hold the recorded blob in memory — bind it to the media id for
  // this session instead of re-reading from OPFS.
  const blobUrl = blobUrlManager.acquire(media.id, result.blob)

  const tracks = useItemsStore.getState().tracks
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order), 0)
  const newTrack = createClassicTrack({ tracks, kind: 'audio', order: maxOrder + 1 })

  const item = buildMediaTimelineItem({
    media: { duration: durationSeconds, fps: 0 },
    mediaId: media.id,
    mediaType: 'audio',
    label: fileName,
    projectFps: fps,
    blobUrl,
    canvasWidth: 0,
    canvasHeight: 0,
    placement: { trackId: newTrack.id, from, durationInFrames },
    originId: crypto.randomUUID(),
  })

  addItemOnNewTrack(item, [...tracks, newTrack])
  useMediaLibraryStore.getState().prependMediaItem(media)
  useSelectionStore.getState().selectItems([item.id])
}

function describeGetUserMediaError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return i18n.t('recording.errors.permissionDenied')
    case 'NotFoundError':
    case 'OverconstrainedError':
      return i18n.t('recording.errors.noDevice')
    case 'NotReadableError':
      return i18n.t('recording.errors.deviceBusy')
    default:
      return i18n.t('recording.errors.startFailed')
  }
}
