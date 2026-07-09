/**
 * Plumbing shared by the workers that re-render a video frame by frame — frame interpolation and
 * upscaling. Both decode with `VideoSampleSink`, replace or invent frames, and encode with
 * `VideoSampleSource`; only the middle differs.
 *
 * Kept out of the feature barrel on purpose: nothing outside `workers/` should reach for this.
 */

import { createLogger } from '@/shared/logging/logger'
import { clampPacketToTimeline } from '../utils/audio-packet-timeline'

const logger = createLogger('RenderSupport')

export type Mediabunny = typeof import('mediabunny')
export type InputInstance = InstanceType<Mediabunny['Input']>
export type OutputInstance = InstanceType<Mediabunny['Output']>
export type VideoSampleInstance = InstanceType<Mediabunny['VideoSample']>
export type VideoSampleSourceInstance = InstanceType<Mediabunny['VideoSampleSource']>
type EncodedPacketInstance = InstanceType<Mediabunny['EncodedPacket']>
type EncodedAudioPacketSourceInstance = InstanceType<Mediabunny['EncodedAudioPacketSource']>

export class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

/** Job-scoped cancellation, checked between frames. */
export class CancellationRegistry {
  private readonly cancelled = new Set<string>()

  cancel(jobId: string): void {
    this.cancelled.add(jobId)
  }

  clear(jobId: string): void {
    this.cancelled.delete(jobId)
  }

  isCancelled(jobId: string): boolean {
    return this.cancelled.has(jobId)
  }

  throwIfCancelled(jobId: string): void {
    if (this.cancelled.has(jobId)) throw new Cancelled()
  }
}

/**
 * Hands samples to the encoder one deep, so the hardware encode of frame N overlaps the decode and
 * inference that produce frame N+1. Awaiting every `add()` inline instead — the obvious way to
 * write it — serializes encode behind inference and costs roughly a third of the wall clock.
 *
 * Depth of one, not unbounded: `add()` is mediabunny's backpressure signal, and a fully un-awaited
 * queue would buffer raw frames until memory ran out.
 *
 * `add()` takes ownership of the sample and closes it even when the encode rejects.
 */
export class EncodeQueue {
  private pending: Promise<void> | null = null
  private encoded = 0

  constructor(private readonly source: VideoSampleSourceInstance) {}

  get count(): number {
    return this.encoded
  }

  async add(sample: VideoSampleInstance): Promise<void> {
    const previous = this.pending
    this.pending = this.source.add(sample).finally(() => sample.close())
    this.encoded++
    if (previous) await previous
  }

  async drain(): Promise<void> {
    await this.pending
    this.pending = null
  }
}

/**
 * Copies the source's audio into the output **without re-encoding**. Both renders preserve the
 * source duration, so its packets are still valid verbatim; passthrough keeps the original quality
 * and costs nothing next to the render.
 *
 * Packets are pumped in step with the video timeline rather than all up front — the muxer would
 * otherwise buffer the entire video track while waiting for audio to catch up.
 *
 * When the source has no audio, or its codec cannot live in an MP4, this becomes a no-op rather
 * than a `null` the render loop has to branch on.
 */
interface AudioStream {
  readonly source: EncodedAudioPacketSourceInstance
  readonly packets: AsyncGenerator<EncodedPacketInstance>
}

class AudioCopier {
  private nextPacket: EncodedPacketInstance | null = null
  private meta: EncodedAudioChunkMetadata | undefined

  /** Null once exhausted, and from the start when there is no audio to copy. */
  private stream: AudioStream | null

  private constructor(stream: AudioStream | null, decoderConfig: AudioDecoderConfig | null) {
    this.stream = stream
    this.meta = decoderConfig ? { decoderConfig } : undefined
  }

  static inert(): AudioCopier {
    return new AudioCopier(null, null)
  }

  static enabled(stream: AudioStream, decoderConfig: AudioDecoderConfig | null): AudioCopier {
    return new AudioCopier(stream, decoderConfig)
  }

  /** Emit every packet whose presentation time has been reached by the video track. */
  async pumpUntil(timestamp: number): Promise<void> {
    const stream = this.stream
    if (!stream) return

    for (;;) {
      this.nextPacket ??= (await stream.packets.next()).value ?? null
      const packet = this.nextPacket
      if (!packet) {
        this.stream = null
        return
      }
      if (packet.timestamp > timestamp) return
      this.nextPacket = null

      const clamped = clampPacketToTimeline(packet)
      if (!clamped) continue

      // `meta` carries the decoder config and is only required on the first packet emitted.
      await stream.source.add(clamped, this.meta)
      this.meta = undefined
    }
  }

  async drain(): Promise<void> {
    await this.pumpUntil(Number.POSITIVE_INFINITY)
  }
}

/** Passthrough is only possible when MP4 can carry the source's audio codec verbatim. */
export async function setupAudioCopy(
  mb: Mediabunny,
  input: InputInstance,
  output: OutputInstance,
): Promise<AudioCopier> {
  const track = await input.getPrimaryAudioTrack()
  const codec = track?.codec
  if (!track || !codec || !output.format.getSupportedAudioCodecs().includes(codec)) {
    if (track) {
      logger.warn('Dropping audio: MP4 cannot carry this codec verbatim', { codec })
    }
    return AudioCopier.inert()
  }

  const source = new mb.EncodedAudioPacketSource(codec)
  output.addAudioTrack(source)
  const packets = new mb.EncodedPacketSink(track).packets()
  return AudioCopier.enabled({ source, packets }, await track.getDecoderConfig())
}

export async function getSourceBlobFromOpfs(path: string, mimeType?: string): Promise<Blob> {
  const root = await navigator.storage.getDirectory()
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('Invalid OPFS source path')

  let dir = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!)
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!)
  const file = await fileHandle.getFile()
  return !mimeType || file.type ? file : new Blob([file], { type: mimeType })
}

/** Scratch `.mp4` files under one OPFS directory, keyed by job id. */
export class OpfsScratch {
  constructor(private readonly directory: string) {}

  private async dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(this.directory, { create: true })
  }

  async createWritable(jobId: string): Promise<FileSystemWritableFileStream> {
    const handle = await (await this.dir()).getFileHandle(`${jobId}.mp4`, { create: true })
    return handle.createWritable()
  }

  async remove(jobId: string): Promise<void> {
    try {
      await (await this.dir()).removeEntry(`${jobId}.mp4`)
    } catch {
      // Nothing to clean up.
    }
  }
}

/**
 * Frame rate implied by the median inter-frame gap. Median, not mean: one long gap at a dropped
 * frame or a scene cut would otherwise drag the estimate down.
 */
export function medianFps(gaps: number[], fallback: number): number {
  if (gaps.length === 0) return fallback
  const sorted = [...gaps].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const gap = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return gap > 0 ? 1 / gap : fallback
}

export function createRenderCanvas(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error(`Failed to acquire 2D context for a ${width}x${height} render`)
  return { canvas, ctx }
}

export async function pickCodec(
  mb: Mediabunny,
  width: number,
  height: number,
): Promise<'hevc' | 'avc'> {
  const canHevc = await mb
    .canEncodeVideo('hevc', { width, height, hardwareAcceleration: 'prefer-hardware' })
    .catch(() => false)
  return canHevc ? 'hevc' : 'avc'
}

/** Open the source and hand back a video sink. Disposes the decoder if anything throws. */
export async function openVideoSource(
  mb: Mediabunny,
  sourceBlob: Blob,
): Promise<{
  input: InputInstance
  sink: InstanceType<Mediabunny['VideoSampleSink']>
  totalSeconds: number
}> {
  const input = new mb.Input({
    source: new mb.BlobSource(sourceBlob),
    formats: [mb.MP4, mb.QTFF, mb.WEBM, mb.MATROSKA],
  })
  // Anything that throws past this point must release the decoder — these workers outlive the
  // job, so a leaked Input holds its decoder for the life of the page.
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) throw new Error('Source has no video track')
    return {
      input,
      sink: new mb.VideoSampleSink(videoTrack),
      totalSeconds: await input.computeDuration(),
    }
  } catch (error) {
    input.dispose()
    throw error
  }
}
