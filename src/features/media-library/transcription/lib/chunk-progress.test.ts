import { describe, expect, it } from 'vite-plus/test'
import {
  getChunkCompletionProgress,
  getChunkEndProgress,
  getChunkStartProgress,
} from './chunk-progress'
import type { PCMChunk } from '../types'

const SAMPLE_RATE = 16_000

function chunk(overrides: Partial<PCMChunk> = {}): PCMChunk {
  return {
    samples: new Float32Array(SAMPLE_RATE * 120),
    timestamp: 0,
    final: false,
    totalDuration: 600,
    ...overrides,
  }
}

describe('chunk-progress', () => {
  it('derives an absolute position from the chunk timestamp', () => {
    expect(getChunkStartProgress(chunk({ timestamp: 118 }))).toBeCloseTo(118 / 600)
    expect(getChunkEndProgress(chunk({ timestamp: 118 }))).toBeCloseTo(238 / 600)
  })

  // The bug this guards: reporting 1 at the end of every chunk drove the monotonic merge to
  // 100% on the first chunk, freezing the bar for the rest of a long file.
  it('advances across successive chunks instead of completing on the first', () => {
    const first = getChunkCompletionProgress(chunk({ timestamp: 0 }))
    const second = getChunkCompletionProgress(chunk({ timestamp: 118 }))

    expect(first).toBeLessThan(1)
    expect(second).toBeGreaterThan(first)
    expect(second).toBeLessThan(1)
  })

  it('clamps a chunk whose overlap runs past the end of the audio', () => {
    expect(getChunkEndProgress(chunk({ timestamp: 118, totalDuration: 150 }))).toBe(1)
  })

  it('always completes the bar on the final chunk', () => {
    expect(getChunkCompletionProgress(chunk({ timestamp: 0, final: true }))).toBe(1)
    // Even when the duration is unknown, the final chunk must land on 100%.
    expect(getChunkCompletionProgress(chunk({ final: true, totalDuration: 0 }))).toBe(1)
  })

  it('reports no position when the producer could not determine a duration', () => {
    expect(getChunkStartProgress(chunk({ totalDuration: 0 }))).toBeNull()
    expect(getChunkEndProgress(chunk({ totalDuration: 0 }))).toBeNull()
    // A non-final chunk with no duration reports 0, which the monotonic merge discards —
    // better a stalled bar than one that invents a position.
    expect(getChunkCompletionProgress(chunk({ totalDuration: 0 }))).toBe(0)
  })
})
