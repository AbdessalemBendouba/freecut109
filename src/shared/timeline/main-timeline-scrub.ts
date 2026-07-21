/**
 * Imperative gesture state shared by the Edit timeline and its keyframe sheet.
 *
 * This intentionally is not React state: both playheads already follow the
 * playback store directly during a scrub, so publishing a render per pointer
 * frame would only add work to the hot path.
 */
export const mainTimelineScrubActiveRef = { current: false }

/** Final global frame retained until the linked editor's props catch up. */
export const mainTimelineScrubHandoffFrameRef: { current: number | null } = {
  current: null,
}
