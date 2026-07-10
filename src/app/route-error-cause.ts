/**
 * Cause extraction for the router error screen.
 *
 * Lives apart from `route-error.tsx` so that file only exports components
 * (Fast Refresh requires it), and so the branching below — the only real logic
 * on that screen — is testable without rendering.
 */

/**
 * The DOMException name behind a route error, or null when there isn't one.
 *
 * Storage failures are re-thrown as a plain `Error` carrying the original
 * DOMException as `cause` (see `workspace-fs/projects.ts`), and the `name` —
 * NotAllowedError vs NotSupportedError vs NotFoundError — is the entire
 * diagnosis. A DOMException thrown directly is also accepted, so this keeps
 * working for callers that don't re-wrap.
 */
export function getStorageFailureName(error: unknown): string | null {
  if (error instanceof DOMException) return error.name
  if (error instanceof Error && error.cause instanceof DOMException) {
    return error.cause.name
  }
  return null
}
