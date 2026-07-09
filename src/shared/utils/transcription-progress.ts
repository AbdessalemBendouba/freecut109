import { formatBytes } from './format-utils'

export type TranscriptionProgressStage =
  | 'queued'
  | 'downloading'
  | 'preparing'
  | 'decoding'
  | 'transcribing'

export interface TranscriptionProgressSnapshot {
  stage: TranscriptionProgressStage
  progress: number
  /** Bytes streamed so far across every model file. Only set while `downloading`. */
  receivedBytes?: number
  /** Total bytes expected across every model file. Only set while `downloading`. */
  totalBytes?: number
  /** True when every model file came from Cache Storage — nothing touched the network. */
  fromCache?: boolean
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(1, progress))
}

/** `preparing` compiles the ONNX graph; neither ORT nor transformers.js exposes progress for it. */
export function isIndeterminateTranscriptionStage(stage: TranscriptionProgressStage): boolean {
  return stage === 'preparing'
}

/**
 * `downloading`/`preparing` come from the ASR worker; `decoding` comes from the decoder
 * worker. Those two run CONCURRENTLY, so they are not one ordered sequence — see
 * `mergeTranscriptionProgress`, which arbitrates between them.
 */
export function isModelStage(stage: TranscriptionProgressStage): boolean {
  return stage === 'downloading' || stage === 'preparing'
}

function isModelComplete(snapshot: TranscriptionProgressSnapshot): boolean {
  return snapshot.stage === 'preparing' && clampProgress(snapshot.progress) >= 1
}

// Band widths reflect real wall-clock cost, not pipeline step count. A cold run is dominated
// by the model transfer — Parakeet ships ~1.2 GB — so `downloading` owns most of the track;
// the compile after it costs ~20 s, audio decode ~1 s, and inference runs at ~30x realtime.
// A warm run skips straight into the later bands, which is honest: the expensive part really
// was skipped. Bands are ordered so progress within a track never steps backward.
export function getTranscriptionOverallProgress(snapshot: TranscriptionProgressSnapshot): number {
  const normalizedProgress = clampProgress(snapshot.progress)

  switch (snapshot.stage) {
    case 'queued':
      return 0
    case 'downloading':
      return normalizedProgress * 0.6
    case 'preparing':
      return 0.6 + normalizedProgress * 0.15
    case 'decoding':
      return 0.75 + normalizedProgress * 0.05
    case 'transcribing':
      return 0.8 + normalizedProgress * 0.2
  }
}

export function getTranscriptionOverallPercent(snapshot: TranscriptionProgressSnapshot): number {
  return getTranscriptionOverallProgress(snapshot) * 100
}

/**
 * Picks which of two concurrently-reported snapshots the user should see.
 *
 * Model loading (`downloading`/`preparing`) and audio prep (`decoding`) run on different
 * workers at the same time. Audio decode takes about a second; a cold model transfer takes
 * minutes. A plain monotonic rule therefore let decode reach 100% of its band immediately and
 * then silently discarded every download update behind it — the bar froze and the multi-minute
 * download was never shown at all.
 *
 * The rule instead is: whichever track is still blocking the job is the one worth showing.
 * Model load blocks transcription, so it outranks audio prep until it finishes; once it does,
 * the audio track takes over. Within a track, progress stays monotonic.
 */
export function mergeTranscriptionProgress(
  previous: TranscriptionProgressSnapshot | undefined,
  next: TranscriptionProgressSnapshot,
): TranscriptionProgressSnapshot {
  const normalizedNext = {
    ...next,
    progress: clampProgress(next.progress),
  } satisfies TranscriptionProgressSnapshot

  if (!previous || previous.stage === 'queued') {
    return normalizedNext
  }

  const nextIsModel = isModelStage(normalizedNext.stage)
  const previousIsModel = isModelStage(previous.stage)

  if (nextIsModel === previousIsModel) {
    // Same track — `>=` rather than `>` so a stalled byte counter still refreshes its bytes.
    return getTranscriptionOverallProgress(normalizedNext) >=
      getTranscriptionOverallProgress(previous)
      ? normalizedNext
      : previous
  }

  if (nextIsModel) {
    // Audio prep finished ahead of the model. Hand the display back to the model unless the
    // model is already done, in which case the audio track is all that's left to report.
    return isModelComplete(normalizedNext) ? previous : normalizedNext
  }

  // Audio progress arrived while the model is still loading — the model is the long pole.
  return isModelComplete(previous) ? normalizedNext : previous
}

export function getTranscriptionStageLabel(stage: TranscriptionProgressStage): string {
  switch (stage) {
    case 'queued':
      return 'Queued'
    case 'downloading':
      return 'Downloading model'
    case 'preparing':
      return 'Preparing model'
    case 'decoding':
      return 'Preparing audio'
    case 'transcribing':
      return 'Transcribing'
  }
}

/** Stage label, corrected for the case where the "download" was served entirely from cache. */
export function getTranscriptionProgressLabel(snapshot: TranscriptionProgressSnapshot): string {
  if (snapshot.stage === 'downloading' && snapshot.fromCache) {
    return 'Loading cached model'
  }
  return getTranscriptionStageLabel(snapshot.stage)
}

/**
 * Secondary line explaining what a stage is doing. Weight transfers get a byte counter so a
 * multi-hundred-MB download reads as progress rather than a stalled percentage; the compile
 * gets prose because it reports no progress at all.
 */
export function getTranscriptionProgressDetail(
  snapshot: TranscriptionProgressSnapshot,
): string | null {
  switch (snapshot.stage) {
    case 'downloading': {
      const { receivedBytes, totalBytes } = snapshot
      if (receivedBytes == null || !totalBytes) return null
      return `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`
    }
    case 'preparing':
      return 'Optimizing for your hardware'
    default:
      return null
  }
}
