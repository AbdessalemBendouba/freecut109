/**
 * Router-level error screen.
 *
 * Errors thrown from a route's `beforeLoad` / `loader` reject before any
 * component mounts, so React error boundaries never see them — TanStack Router
 * catches them itself. With no `defaultErrorComponent` configured it falls back
 * to its own built-in: a hardcoded, untranslated "Something went wrong!" whose
 * message is hidden behind a "Show Error" toggle in production builds. A user
 * whose workspace folder cannot be read therefore sees three words on a blank
 * page, and their bug report carries nothing.
 *
 * This screen replaces that. It always shows the real message (production
 * included), names the underlying DOMException when there is one, and offers
 * the recovery that actually applies: for a storage fault, picking a different
 * folder — the workspace is a user-chosen directory, and some directories
 * (cloud-synced or network mounts) cannot support every filesystem operation.
 */

import { useState } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'

import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/shared/logging/logger'
import {
  ensureKnownWorkspaceForCurrent,
  getWorkspaceHandleRecord,
  removeKnownWorkspace,
} from '@/infrastructure/storage/handles-db'
import { getStorageFailureName } from './route-error-cause'

const logger = createLogger('RouteError')

/** Known DOMException names get a plain-language explanation; others don't. */
const CAUSE_EXPLANATION_KEYS: Record<string, string> = {
  NotAllowedError: 'app.routeError.causePermission',
  NotFoundError: 'app.routeError.causeMissing',
  NotSupportedError: 'app.routeError.causeUnsupported',
  SecurityError: 'app.routeError.causePermission',
}

export function RouteErrorScreen({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const [isSwitchingFolder, setIsSwitchingFolder] = useState(false)

  const failureName = getStorageFailureName(error)
  const explanationKey = failureName ? CAUSE_EXPLANATION_KEYS[failureName] : undefined
  const description = explanationKey ? t(explanationKey) : t('app.routeError.description')

  const handleRetry = () => {
    reset()
    void router.invalidate()
  }

  /**
   * Forget the active workspace so `WorkspaceGate` reverts to its pick-folder
   * state on the next render. This only deletes the handle registry record —
   * never the user's files.
   */
  const handleChooseDifferentFolder = async () => {
    setIsSwitchingFolder(true)
    try {
      await ensureKnownWorkspaceForCurrent()
      const record = await getWorkspaceHandleRecord()
      if (record?.activeWorkspaceId) {
        await removeKnownWorkspace(record.activeWorkspaceId)
      }
      window.location.reload()
    } catch (cause) {
      logger.error('Failed to release the active workspace', cause)
      setIsSwitchingFolder(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        <FreeCutLogo variant="full" size="lg" className="justify-center mb-8" />

        <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />

        <h1 className="text-lg font-semibold">{t('app.routeError.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>

        {/*
          Always rendered, production included. The built-in fallback hid this
          behind a toggle, which is precisely what made the original reports
          undiagnosable.
        */}
        <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-left font-mono text-xs wrap-break-word">
          {error.message}
          {failureName && <span className="text-muted-foreground"> — {failureName}</span>}
        </p>

        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button variant="outline" className="gap-2" onClick={handleRetry}>
            <RefreshCw className="h-4 w-4" />
            {t('app.errorBoundary.tryAgain')}
          </Button>
          <Button onClick={() => window.location.reload()}>
            {t('app.errorBoundary.reloadPage')}
          </Button>
        </div>

        {failureName && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 gap-2"
            disabled={isSwitchingFolder}
            onClick={handleChooseDifferentFolder}
          >
            <FolderOpen className="h-4 w-4" />
            {t('projects.workspaceGate.chooseDifferentFolder')}
          </Button>
        )}

        {import.meta.env.DEV && error.stack && (
          <pre className="mt-4 p-4 bg-muted rounded text-xs text-left overflow-auto max-h-48">
            {error.stack}
          </pre>
        )}
      </div>
    </div>
  )
}
