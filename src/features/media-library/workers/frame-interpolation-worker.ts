/**
 * Frame Interpolation Worker
 *
 * Renders a higher-frame-rate copy of a video: same duration, `factor`x the frames, with the
 * in-between frames synthesized by RIFE on WebGPU. The output is written to an OPFS scratch
 * file; the service imports it into the media library and deletes the scratch copy.
 *
 * This cannot use mediabunny's high-level `Conversion` API the way proxy generation does —
 * `Conversion` is a straight transcode with no hook to inject invented frames. So we drive
 * `VideoSampleSink` for decode and `VideoSampleSource` for encode, with RIFE in between.
 *
 * Audio is not carried over. The interpolated video has the same duration, so the original's
 * audio still lines up if the user wants it on a separate track.
 */

import { ensureProResDecoderRegistered } from '@/infrastructure/browser/register-prores-decoder'
import {
  clampRenderSize,
  interpolateGap,
  planarRgbToRgba,
  RenderProgress,
  rgbaToPlanarRgb,
  RifeInterpolator,
  type InterpolationFactor,
} from '@/infrastructure/interpolation'
import { createLogger } from '@/shared/logging/logger'
import {
  INTERPOLATION_TMP_DIR,
  interpolationTmpPath,
  type InterpolationResult,
  type InterpolationStage,
} from '../frame-interpolation-constants'
import { clampPacketToTimeline } from '../utils/audio-packet-timeline'

const logger = createLogger('FrameInterpolationWorker')

const KEYFRAME_INTERVAL_SECONDS = 2
const STREAM_CHUNK_SIZE_BYTES = 4 * 1024 * 1024

export interface InterpolateRequest {
  type: 'interpolate'
  jobId: string
  source?: Blob
  sourceOpfsPath?: string
  sourceMimeType?: string
  sourceWidth: number
  sourceHeight: number
  sourceFps: number
  factor: InterpolationFactor
}

export interface InterpolateCancelRequest {
  type: 'cancel'
  jobId: string
}

export interface InterpolationProgressResponse {
  type: 'progress'
  jobId: string
  stage: InterpolationStage
  /** 0..1 within the current stage. */
  progress: number
  /** Seconds left in the render, or null while the rate estimate warms up. */
  etaSeconds?: number | null
  fromCache?: boolean
}

export interface InterpolationCompleteResponse {
  type: 'complete'
  jobId: string
  opfsPath: string
  result: InterpolationResult
}

export interface InterpolationErrorResponse {
  type: 'error'
  jobId: string
  error: string
}

export interface InterpolationCancelledResponse {
  type: 'cancelled'
  jobId: string
}

export type InterpolationWorkerRequest = InterpolateRequest | InterpolateCancelRequest
export type InterpolationWorkerResponse =
  | InterpolationProgressResponse
  | InterpolationCompleteResponse
  | InterpolationErrorResponse
  | InterpolationCancelledResponse

const cancelledJobs = new Set<string>()

/** Compiled sessions and model bytes survive across jobs — each session costs ~500ms. */
let interpolator: RifeInterpolator | null = null

const loadMediabunny = async () => import('mediabunny')

function post(message: InterpolationWorkerResponse): void {
  self.postMessage(message)
}

class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

function throwIfCancelled(jobId: string): void {
  if (cancelledJobs.has(jobId)) throw new Cancelled()
}

async function getSourceBlobFromOpfs(path: string, mimeType?: string): Promise<Blob> {
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

async function createTmpWritable(jobId: string): Promise<FileSystemWritableFileStream> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(INTERPOLATION_TMP_DIR, { create: true })
  const handle = await dir.getFileHandle(`${jobId}.mp4`, { create: true })
  return handle.createWritable()
}

async function removeTmpFile(jobId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(INTERPOLATION_TMP_DIR, { create: true })
    await dir.removeEntry(`${jobId}.mp4`)
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Frame rate implied by the median inter-frame gap. Median, not mean: one long gap at a
 * dropped frame or a scene cut would otherwise drag the estimate down.
 */
function medianFps(gaps: number[], fallback: number): number {
  if (gaps.length === 0) return fallback
  const sorted = [...gaps].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const gap = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return gap > 0 ? 1 / gap : fallback
}

function createRenderCanvas(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Failed to acquire 2D context for frame interpolation')
  return { canvas, ctx }
}

async function pickCodec(
  mb: Awaited<ReturnType<typeof loadMediabunny>>,
  width: number,
  height: number,
): Promise<'hevc' | 'avc'> {
  const canHevc = await mb
    .canEncodeVideo('hevc', { width, height, hardwareAcceleration: 'prefer-hardware' })
    .catch(() => false)
  return canHevc ? 'hevc' : 'avc'
}

type Mediabunny = Awaited<ReturnType<typeof loadMediabunny>>
type VideoSampleSourceInstance = InstanceType<Mediabunny['VideoSampleSource']>
type VideoSampleInstance = InstanceType<Mediabunny['VideoSample']>
type EncodedPacketInstance = InstanceType<Mediabunny['EncodedPacket']>
type EncodedAudioPacketSourceInstance = InstanceType<Mediabunny['EncodedAudioPacketSource']>

/**
 * Hands samples to the encoder one deep, so the hardware encode of frame N overlaps the
 * decode/inference that produces frame N+1. Awaiting every `add()` inline instead — the
 * obvious way to write it — serialized encode behind inference and cost roughly a third of
 * the wall clock.
 *
 * Depth of one, not unbounded: `add()` is mediabunny's backpressure signal, and a fully
 * un-awaited queue would buffer raw frames until memory ran out.
 */
class EncodeQueue {
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
 * Copies the source's audio into the output **without re-encoding**: the interpolated video has
 * the same duration, so its packets are still valid verbatim. Passthrough keeps the original
 * quality and costs nothing next to the render.
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
async function setupAudioCopy(
  mb: Mediabunny,
  input: InstanceType<Mediabunny['Input']>,
  output: InstanceType<Mediabunny['Output']>,
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

function assertUsableSourceFps(sourceFps: number): void {
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) {
    throw new Error(`Frame interpolation needs a known source frame rate, got ${sourceFps}`)
  }
}

/** Release a decoded frame the encode queue never took ownership of. */
function releaseUnqueuedFrame(frame: { encoded: VideoSampleInstance | null } | null): void {
  frame?.encoded?.close()
}

/** Warm the shared RIFE session, reporting the one-time model download against `jobId`. */
async function ensureInterpolator(jobId: string): Promise<RifeInterpolator> {
  if (!interpolator) {
    interpolator = new RifeInterpolator({
      onDownloadProgress: ({ receivedBytes, totalBytes, fromCache }) => {
        post({
          type: 'progress',
          jobId,
          stage: 'downloading-model',
          progress: totalBytes > 0 ? receivedBytes / totalBytes : 0,
          fromCache,
        })
      },
    })
  }
  const rife = interpolator
  await rife.ready()
  return rife
}

async function openSource(mb: Mediabunny, request: InterpolateRequest) {
  const sourceBlob = request.source
    ? request.source
    : await getSourceBlobFromOpfs(request.sourceOpfsPath!, request.sourceMimeType)

  const input = new mb.Input({
    source: new mb.BlobSource(sourceBlob),
    formats: [mb.MP4, mb.QTFF, mb.WEBM, mb.MATROSKA],
  })
  // Anything that throws past this point must release the decoder — this worker outlives the
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

/** Render target + encoder. Split out so `interpolate` can dispose the decoder if it throws. */
async function setupRender(
  mb: Mediabunny,
  request: InterpolateRequest,
  input: InstanceType<Mediabunny['Input']>,
): Promise<{
  width: number
  height: number
  outputFps: number
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  output: InstanceType<Mediabunny['Output']>
  videoSource: InstanceType<Mediabunny['VideoSampleSource']>
  audio: AudioCopier
  codec: string
}> {
  const { width, height } = clampRenderSize(request.sourceWidth, request.sourceHeight)
  const outputFps = request.sourceFps * request.factor
  const { canvas, ctx } = createRenderCanvas(width, height)
  const { output, videoSource, codec } = await createEncoder(
    mb,
    request.jobId,
    width,
    height,
    outputFps,
  )
  // Every track must be declared before `start()`.
  const audio = await setupAudioCopy(mb, input, output)
  await output.start()
  return { width, height, outputFps, canvas, ctx, output, videoSource, audio, codec }
}

async function createEncoder(
  mb: Mediabunny,
  jobId: string,
  width: number,
  height: number,
  outputFps: number,
) {
  const writable = await createTmpWritable(jobId)
  const codec = await pickCodec(mb, width, height)
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: false }),
    target: new mb.StreamTarget(writable, { chunked: true, chunkSize: STREAM_CHUNK_SIZE_BYTES }),
  })
  const videoSource = new mb.VideoSampleSource({
    codec,
    bitrate: mb.QUALITY_HIGH,
    keyFrameInterval: KEYFRAME_INTERVAL_SECONDS,
    latencyMode: 'quality',
  })
  output.addVideoTrack(videoSource, { frameRate: outputFps })
  return { output, videoSource, codec }
}

async function interpolate(request: InterpolateRequest): Promise<void> {
  const { jobId, factor, sourceWidth, sourceHeight, sourceFps } = request

  assertUsableSourceFps(sourceFps)
  await ensureProResDecoderRegistered()
  const mb = await loadMediabunny()

  const rife = await ensureInterpolator(jobId)
  throwIfCancelled(jobId)
  post({ type: 'progress', jobId, stage: 'preparing', progress: 0 })

  const { input, sink, totalSeconds } = await openSource(mb, request)
  const { width, height, canvas, ctx, output, videoSource, audio, codec } = await setupRender(
    mb,
    request,
    input,
  ).catch((error: unknown) => {
    input.dispose()
    throw error
  })

  const scratchRgba = new Uint8ClampedArray(width * height * 4)
  const queue = new EncodeQueue(videoSource)

  /** Encode a frame RIFE invented. Only synthesized frames pay the float -> RGBA cost. */
  const encodePlanar = (planar: Float32Array, timestamp: number, duration: number) => {
    planarRgbToRgba(planar, width, height, scratchRgba)
    ctx.putImageData(new ImageData(scratchRgba, width, height), 0, 0)
    return queue.add(new mb.VideoSample(canvas, { timestamp, duration }))
  }

  /**
   * Draw a decoded frame once, then take two things from the canvas: the planar tensor RIFE
   * needs, and an encoder-ready snapshot. Source frames used to be rebuilt from their own
   * float tensor on the way out — a pointless round trip through 921k pixels of JS.
   * `VideoSample` copies the canvas, so overwriting it for the next frame is safe.
   */
  const decodeFrame = (sample: InstanceType<typeof mb.VideoSample>) => {
    sample.draw(ctx, 0, 0, width, height)
    return {
      planar: rgbaToPlanarRgb(ctx.getImageData(0, 0, width, height).data, width, height),
      // Timestamps are rewritten once the gap to the next frame is known.
      encoded: new mb.VideoSample(canvas, { timestamp: 0, duration: 0 }),
    }
  }

  // `sourceFps` from the media library is only a hint — every import path probes with
  // `fastMetadata: true`, which hard-codes 30. Both the reported output rate and the progress
  // estimate re-derive it from the decoded timestamps.
  const gaps: number[] = []
  const progress = new RenderProgress(totalSeconds, sourceFps)
  let sourceFramesSeen = 0

  // `encoded` is nulled the moment the queue takes ownership, so the error path can close a
  // frame that was never handed over without risking a double close.
  let prev: { planar: Float32Array; encoded: VideoSampleInstance | null } | null = null
  let prevTimestamp = 0
  let lastGap = 1 / sourceFps

  try {
    for await (const sample of sink.samples()) {
      throwIfCancelled(jobId)

      const timestamp = sample.timestamp
      let current: ReturnType<typeof decodeFrame>
      try {
        current = decodeFrame(sample)
      } finally {
        sample.close()
      }

      let gapSeconds: number | null = null
      if (prev?.encoded) {
        // Derive the sub-frame step from the real gap rather than 1/sourceFps, so
        // variable-frame-rate sources keep their timing instead of being resampled.
        const gap = Math.max(timestamp - prevTimestamp, 1e-6)
        gapSeconds = gap
        lastGap = gap
        gaps.push(gap)
        const step = gap / factor

        const sourceFrame = prev.encoded
        prev.encoded = null
        sourceFrame.setTimestamp(prevTimestamp)
        sourceFrame.setDuration(step)
        await queue.add(sourceFrame)

        const between = await interpolateGap(prev.planar, current.planar, factor, (left, right) =>
          rife.interpolate(left, right, width, height),
        )
        for (let k = 0; k < between.length; k++) {
          throwIfCancelled(jobId)
          await encodePlanar(between[k]!, prevTimestamp + step * (k + 1), step)
        }

        // Keep the audio track level with the video the muxer has just received.
        await audio.pumpUntil(timestamp)
      }

      prev = current
      prevTimestamp = timestamp
      sourceFramesSeen++
      progress.tick(performance.now(), gapSeconds)

      post({
        type: 'progress',
        jobId,
        stage: 'rendering',
        progress: progress.fraction,
        etaSeconds: progress.etaSeconds,
      })
    }

    if (!prev?.encoded) throw new Error('Source produced no decodable video frames')

    // Trailing source frame: nothing follows it, so it gets one inter-frame duration.
    const lastFrame = prev.encoded
    prev.encoded = null
    lastFrame.setTimestamp(prevTimestamp)
    lastFrame.setDuration(lastGap / factor)
    await queue.add(lastFrame)
    await queue.drain()
    await audio.drain()

    const frameCount = queue.count
    await output.finalize()

    const measuredSourceFps = medianFps(gaps, sourceFps)
    const result: InterpolationResult = {
      factor,
      width,
      height,
      sourceWidth,
      sourceHeight,
      sourceFps: measuredSourceFps,
      outputFps: measuredSourceFps * factor,
      codec,
      frameCount,
    }

    logger.info('Frame interpolation complete', {
      jobId,
      factor,
      width,
      height,
      sourceFrames: sourceFramesSeen,
      outputFrames: frameCount,
      backend: rife.activeBackend,
    })
    post({ type: 'complete', jobId, opfsPath: interpolationTmpPath(jobId), result })
  } catch (error) {
    // Release the frame the queue never took, and settle the in-flight encode before
    // cancelling — an un-awaited rejected `add()` would surface as an unhandled rejection.
    releaseUnqueuedFrame(prev)
    await queue.drain().catch(() => {})
    // `output.cancel()` releases the encoder and closes the writable. Without it the partial
    // OPFS file stays locked and a retry cannot reopen it.
    await output.cancel().catch(() => {})
    await removeTmpFile(jobId)
    throw error
  } finally {
    input.dispose()
  }
}

self.onmessage = async (event: MessageEvent<InterpolationWorkerRequest>) => {
  const request = event.data

  if (request.type === 'cancel') {
    cancelledJobs.add(request.jobId)
    return
  }

  const { jobId } = request
  cancelledJobs.delete(jobId)

  try {
    await interpolate(request)
  } catch (error) {
    if (error instanceof Cancelled || cancelledJobs.has(jobId)) {
      await removeTmpFile(jobId)
      post({ type: 'cancelled', jobId })
    } else {
      logger.error('Frame interpolation failed', { jobId, error })
      post({
        type: 'error',
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    cancelledJobs.delete(jobId)
  }
}
