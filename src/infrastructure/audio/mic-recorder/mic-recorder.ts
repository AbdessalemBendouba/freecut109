/**
 * Microphone recorder engine — a thin, framework-agnostic wrapper around
 * `getUserMedia` + `MediaRecorder` used by the timeline voiceover feature.
 *
 * Responsibilities:
 * - Acquire a mic stream (optionally a specific device) with the usual voice
 *   processing (echo cancellation / noise suppression / auto gain).
 * - Meter input level (RMS 0..1) via a dedicated {@link AudioContext} +
 *   `AnalyserNode`, starting the moment the stream is live so a picker can show
 *   levels before the user commits to recording.
 * - Record to a single {@link Blob} using the best-supported container/codec.
 * - Track wall-clock duration excluding paused spans.
 *
 * It deliberately does NOT route the mic to the speakers (no monitoring) to
 * avoid feedback, and knows nothing about the timeline, playback, or React.
 */

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4', // Safari
] as const

/**
 * Pick the first container/codec this browser can actually record. Returns an
 * empty string to let `MediaRecorder` choose its own default when none of the
 * known-good candidates are supported.
 */
export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') {
    return ''
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return ''
}

/** Map a recording mime type to a sensible file extension. */
export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('mp4')) return 'm4a'
  return 'webm'
}

export interface MicRecorderResult {
  blob: Blob
  mimeType: string
  /** Recorded audio duration in milliseconds, excluding paused spans. */
  durationMs: number
}

export interface MicRecorderOptions {
  deviceId?: string
  /** Called ~30x/s with the current input level (RMS, 0..1) while a stream is live. */
  onLevel?: (level: number) => void
}

type EngineState = 'idle' | 'recording' | 'paused'

export class MicRecorder {
  private state: EngineState = 'idle'
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType = ''

  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private meterData: Uint8Array<ArrayBuffer> | null = null
  private meterRafId: number | null = null
  private onLevel: ((level: number) => void) | undefined

  // Duration accounting (excludes paused spans).
  private startedAtMs = 0
  private accumulatedMs = 0

  getState(): EngineState {
    return this.state
  }

  /**
   * Acquire the mic and begin recording. Resolves once `MediaRecorder` has
   * fired its `start` event, i.e. capture is genuinely underway — the caller
   * uses that moment to align the recording with the playhead.
   */
  async start(options: MicRecorderOptions = {}): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error('MicRecorder is already active')
    }
    this.onLevel = options.onLevel

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    }

    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    this.startMetering(this.stream)

    this.mimeType = pickRecorderMimeType()
    this.chunks = []
    const recorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream)
    // The browser may have picked a different container than we requested.
    this.mimeType = recorder.mimeType || this.mimeType
    this.recorder = recorder

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        this.chunks.push(event.data)
      }
    })

    await new Promise<void>((resolve, reject) => {
      const onStart = () => {
        recorder.removeEventListener('error', onError)
        this.startedAtMs = performance.now()
        this.accumulatedMs = 0
        this.state = 'recording'
        resolve()
      }
      const onError = (event: Event) => {
        recorder.removeEventListener('start', onStart)
        const error = (event as unknown as { error?: DOMException }).error
        reject(error ?? new Error('MediaRecorder failed to start'))
      }
      recorder.addEventListener('start', onStart, { once: true })
      recorder.addEventListener('error', onError, { once: true })
      recorder.start()
    })
  }

  pause(): void {
    if (this.state !== 'recording' || !this.recorder) return
    this.recorder.pause()
    this.accumulatedMs += performance.now() - this.startedAtMs
    this.state = 'paused'
  }

  resume(): void {
    if (this.state !== 'paused' || !this.recorder) return
    this.recorder.resume()
    this.startedAtMs = performance.now()
    this.state = 'recording'
  }

  /** Duration recorded so far in ms, excluding paused spans. */
  elapsedMs(): number {
    if (this.state === 'recording') {
      return this.accumulatedMs + (performance.now() - this.startedAtMs)
    }
    return this.accumulatedMs
  }

  /**
   * Stop recording and resolve with the assembled blob. Releases the mic and
   * audio context. Safe to call from either recording or paused state.
   */
  async stop(): Promise<MicRecorderResult> {
    const recorder = this.recorder
    if (!recorder || this.state === 'idle') {
      throw new Error('MicRecorder is not active')
    }

    if (this.state === 'recording') {
      this.accumulatedMs += performance.now() - this.startedAtMs
    }
    const durationMs = this.accumulatedMs

    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(this.chunks, { type: this.mimeType || 'audio/webm' })),
        { once: true },
      )
      recorder.stop()
    })

    const mimeType = this.mimeType
    this.dispose()
    return { blob, mimeType, durationMs }
  }

  /** Tear down the mic stream, recorder, and metering. Idempotent. */
  dispose(): void {
    this.state = 'idle'
    this.stopMetering()

    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch {
        // Already stopping — ignore.
      }
    }
    this.recorder = null
    this.chunks = []

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
      this.stream = null
    }

    if (this.audioContext) {
      void this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
    this.analyser = null
    this.meterData = null
    this.onLevel = undefined
  }

  private startMetering(stream: MediaStream): void {
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined
    if (!Ctor) return

    try {
      const context = new Ctor()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)

      this.audioContext = context
      this.analyser = analyser
      this.meterData = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      this.tickMeter()
    } catch {
      // Metering is best-effort — a failure here must not break recording.
      this.audioContext = null
      this.analyser = null
    }
  }

  private tickMeter = (): void => {
    const analyser = this.analyser
    const data = this.meterData
    if (!analyser || !data) return

    analyser.getByteTimeDomainData(data)
    let sumSquares = 0
    for (let i = 0; i < data.length; i += 1) {
      // Byte samples are centered at 128; normalize to [-1, 1].
      const sample = (data[i]! - 128) / 128
      sumSquares += sample * sample
    }
    const rms = Math.sqrt(sumSquares / data.length)
    this.onLevel?.(Math.min(1, rms))

    this.meterRafId = requestAnimationFrame(this.tickMeter)
  }

  private stopMetering(): void {
    if (this.meterRafId !== null) {
      cancelAnimationFrame(this.meterRafId)
      this.meterRafId = null
    }
  }
}
