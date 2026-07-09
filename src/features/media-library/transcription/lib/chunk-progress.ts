import type { PCMChunk } from '../types'

const SAMPLE_RATE = 16_000

/**
 * Absolute position of a chunk within the whole audio, as a 0..1 fraction.
 *
 * The ASR workers see one chunk at a time and have no idea how many follow, so reporting
 * per-chunk progress (0 at the start, 1 at the end) made the bar jump to 100% as soon as the
 * first chunk landed — `mergeTranscriptionProgress` is monotonic, so every later chunk's
 * progress was then discarded. Deriving the position from the chunk's timestamp against the
 * total duration fixes that.
 *
 * Both return null when the producer could not determine a duration, in which case callers
 * must report progress only on the final chunk rather than inventing a position.
 */
export function getChunkStartProgress(chunk: PCMChunk): number | null {
  if (!(chunk.totalDuration > 0)) return null
  return Math.min(chunk.timestamp / chunk.totalDuration, 1)
}

export function getChunkEndProgress(chunk: PCMChunk): number | null {
  if (!(chunk.totalDuration > 0)) return null
  // Chunks overlap by a couple of seconds, so a chunk's samples can run slightly past the
  // next chunk's start. Clamping keeps the fraction inside the track.
  const endSeconds = chunk.timestamp + chunk.samples.length / SAMPLE_RATE
  return Math.min(endSeconds / chunk.totalDuration, 1)
}

/**
 * Progress to report once a chunk has been transcribed. The final chunk always completes the
 * bar, even when a rounding shortfall or a missing duration would otherwise leave it short.
 */
export function getChunkCompletionProgress(chunk: PCMChunk): number {
  if (chunk.final) return 1
  return getChunkEndProgress(chunk) ?? 0
}
