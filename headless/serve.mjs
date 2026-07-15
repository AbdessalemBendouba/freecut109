// FreeCut headless render service.
//
// Launches one warm headless Chrome + harness over a workspace and exposes a
// small HTTP API, so renders/edits avoid the per-call browser cold start.
// Requests are serialized (one page op at a time) to avoid GPU/CPU contention.
//
// Usage:
//   node headless/serve.mjs --workspace <dir> [--host 127.0.0.1] [--port 8787] [--build] [--head] [--harness-url <url>]
//
// API:
//   GET  /health                      -> { ok, harnessUrl }
//   GET  /projects                    -> [{ id, name, updatedAt }]
//   POST /render  { project|projectObject, codec?, container?, resolution?, fps?,
//                   quality?, in?, outSec?, duration?, audioOnly? }
//                                      -> the rendered video/audio file (attachment)
//   POST /edit    { project|projectObject, ops, ... }
//                                      -> { ok, project, applied, results } (edited project JSON)
//
// Example:
//   curl -X POST localhost:8787/render -H 'content-type: application/json' \
//     -d '{"project":"<id>","codec":"vp9","duration":5}' -o out.webm
import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadProject, listProjects, collectAddClipMedia } from './lib/workspace.mjs'
import { parseArgs, chromeLaunchArgs } from './lib/cli.mjs'
import { prepareJob, renderJob, startHarness, warningsHeaderValue } from './lib/render-core.mjs'
import { OperationQueue, OperationQueueError } from './lib/operation-queue.mjs'
import { PageSession, probeGpu } from './lib/page-session.mjs'
import {
  HEADLESS_API_VERSION,
  ContractValidationError,
  capabilities,
  editRequestSchema,
  renderRequestSchema,
  validate,
} from './lib/contract.mjs'

const HELP = `Usage: node headless/serve.mjs --workspace <dir> [options]\n\nOptions:\n  --host <address>           Bind address (default: 127.0.0.1)\n  --port <n>                 HTTP port (default: 8787)\n  --render-timeout-ms <n>    Whole render deadline (default: 1800000)\n  --edit-timeout-ms <n>      Whole edit deadline (default: 120000)\n  --max-queue-depth <n>      Waiting operations allowed behind the active one (default: 8)\n  --shutdown-timeout-ms <n>  Graceful queue drain deadline (default: 30000)\n  --build  --head  --harness-url <url>\n`
const SERVE_OPTIONS = new Set([
  'workspace', 'host', 'port', 'build', 'head', 'harness-url', 'help', 'render-timeout-ms',
  'edit-timeout-ms', 'max-queue-depth', 'shutdown-timeout-ms',
])

/** Resolve the service bind address without exposing native runs by default. */
export function resolveHost(args = {}, env = process.env) {
  const host = Object.prototype.hasOwnProperty.call(args, 'host')
    ? args.host
    : Object.prototype.hasOwnProperty.call(env, 'FREECUT_HOST')
      ? env.FREECUT_HOST
      : '127.0.0.1'

  if (typeof host !== 'string' || host.trim() === '') {
    throw new Error('Host must be a non-empty string (--host or FREECUT_HOST)')
  }
  return host.trim()
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 64 * 1024 * 1024) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${e.message}`))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

/** Heuristic: is this a software (CPU) WebGPU adapter rather than a real GPU? */
function isSoftwareGpu(gpu) {
  if (!gpu?.available) return true
  const s = `${gpu.vendor} ${gpu.architecture} ${gpu.description}`.toLowerCase()
  return /llvmpipe|lavapipe|swiftshader|software|mesa/.test(s)
}

async function main() {
  const { chromium } = await import('playwright')
  const args = parseArgs(process.argv.slice(2), { allowed: SERVE_OPTIONS })
  if (args.help) { console.log(HELP); return }
  const workspace = args.workspace
  if (!workspace) throw new Error('Missing --workspace <dir>')
  if (!fs.existsSync(workspace)) throw new Error(`Workspace not found: ${workspace}`)
  const host = resolveHost(args)
  const port = args.port ? Number(args.port) : 8787
  const positiveInt = (name, fallback, { min = 1, max = 86_400_000 } = {}) => {
    const value = args[name] === undefined ? fallback : Number(args[name])
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`--${name} must be an integer between ${min} and ${max}`)
    }
    return value
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer between 0 and 65535')
  const renderTimeoutMs = positiveInt('render-timeout-ms', 30 * 60_000)
  const editTimeoutMs = positiveInt('edit-timeout-ms', 2 * 60_000)
  const maxQueueDepth = positiveInt('max-queue-depth', 8, { min: 0, max: 10_000 })
  const shutdownTimeoutMs = positiveInt('shutdown-timeout-ms', 30_000)

  const { harnessUrl, mediaUrlOf, closeServers } = await startHarness({
    workspace,
    devUrl: args['harness-url'],
    build: args.build,
  })

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.head,
    args: chromeLaunchArgs(),
  })
  const session = new PageSession({
    browser,
    harnessUrl,
    onPageError: (e) => console.error('[pageerror]', e.message),
  })
  await session.open()

  // Report the WebGPU adapter so it's obvious whether this is a real GPU.
  let gpu = await probeGpu(session.page)
  if (gpu.available) {
    console.log(`WebGPU adapter: ${gpu.vendor || '?'} / ${gpu.architecture || gpu.description || '?'}`)
  }
  if (isSoftwareGpu(gpu)) {
    console.warn(
      'WARNING: WebGPU is software (no real GPU) — GPU effects will fail. ' +
        'Run on a Linux host with an NVIDIA GPU + Container Toolkit (--gpus all ' +
        '-e NVIDIA_DRIVER_CAPABILITIES=all), or render natively on Windows/macOS.',
    )
  }

  const queue = new OperationQueue({
    maxQueueDepth,
    recover: async (error) => {
      console.error(`Recreating browser page after failed operation: ${error.message ?? error}`)
      if (!queue.accepting) {
        await session.close()
        return
      }
      await session.recreate()
      gpu = await probeGpu(session.page)
    },
  })

  const tmpDir = path.join(os.tmpdir(), 'freecut-serve')
  fs.mkdirSync(tmpDir, { recursive: true })
  let counter = 0

  const handleRender = async (req, res) => {
    const body = validate(renderRequestSchema, await readJsonBody(req))
    const outPath = path.join(tmpDir, `render-${process.pid}-${++counter}.out`)
    const job = prepareJob(workspace, { ...body, out: outPath }, mediaUrlOf)

    const t0 = Date.now()
    const summary = await queue.enqueue(
      () => renderJob(session.page, job, { downloadTimeoutMs: 0 }),
      { timeoutMs: renderTimeoutMs, kind: 'render' },
    )
    console.log(
      `render ${job.project.name ?? job.project.id} -> ${summary.effectiveSettings.container} ` +
        `(${(summary.fileSize / 1e6).toFixed(2)}MB, ${summary.durationSeconds.toFixed(2)}s) in ${Date.now() - t0}ms`,
    )

    res.writeHead(200, {
      'Content-Type': summary.mimeType,
      'Content-Length': fs.statSync(summary.outputPath).size,
      'Content-Disposition': `attachment; filename="${summary.fileName}"`,
      // Header values must be ASCII; sanitize defensively so a warning never
      // turns a successful render into a 500.
      ...(summary.warnings?.length
        ? { 'X-Freecut-Warnings': warningsHeaderValue(summary.warnings) }
        : {}),
    })
    const stream = fs.createReadStream(summary.outputPath)
    stream.pipe(res)
    stream.on('close', () => fs.rm(summary.outputPath, () => {}))
  }

  const handleEdit = async (req, res) => {
    const body = validate(editRequestSchema, await readJsonBody(req))
    const project = body.projectObject ?? loadProject(workspace, body.project).project
    const ops = body.ops
    const media = collectAddClipMedia(workspace, ops)
    const result = await queue.enqueue(
      () => session.page.evaluate((payload) => window.freecut.editProject(payload), { project, ops, media }),
      { timeoutMs: editTimeoutMs, kind: 'edit' },
    )
    sendJson(res, 200, result)
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = `${req.method} ${url.pathname}`
    const handler =
      route === 'GET /health'
        ? async () => {
            sendJson(res, 200, { ok: true, apiVersion: HEADLESS_API_VERSION, gpu, software: isSoftwareGpu(gpu), harnessUrl })
          }
        : route === 'GET /capabilities'
          ? async () => sendJson(res, 200, capabilities())
        : route === 'GET /projects'
          ? async () => sendJson(res, 200, listProjects(workspace))
          : route === 'POST /render'
            ? () => handleRender(req, res)
            : route === 'POST /edit'
              ? () => handleEdit(req, res)
              : null
    if (!handler) {
      sendJson(res, 404, { error: `No route: ${route}` })
      return
    }
    handler().catch((e) => {
      console.error(`${route} failed:`, e.message ?? e)
      if (!res.headersSent) {
        const validation = e instanceof ContractValidationError || String(e.message).startsWith('Invalid JSON body:')
        const missingMedia = e.code === 'MISSING_MEDIA'
        const status = validation ? 400 : missingMedia ? 422 : e instanceof OperationQueueError ? e.statusCode : 500
        sendJson(res, status, {
          error: {
            code: validation ? (e.code ?? 'INVALID_JSON') : (e.code ?? 'INTERNAL_ERROR'),
            message: e.message ?? String(e), fields: e.fields ?? [],
            ...(missingMedia ? { mediaIds: e.mediaIds } : {}),
            apiVersion: HEADLESS_API_VERSION,
          },
        })
      }
      else res.destroy()
    })
  })

  // The default remains loopback-only because the render service has no auth.
  // Network exposure must be an explicit CLI/environment configuration choice.
  await new Promise((resolve) => server.listen(port, host, resolve))
  console.log(`FreeCut render service on http://${host}:${port}  (workspace: ${workspace})`)
  console.log(`  GET /health  GET /capabilities  GET /projects  POST /render  POST /edit`)

  let shuttingDown
  const shutdown = () => shuttingDown ??= (async () => {
    console.log('\nShutting down...')
    const serverClosed = new Promise((resolve) => server.close(resolve))
    try {
      await queue.shutdown(shutdownTimeoutMs)
    } catch (error) {
      console.error(error.message)
    } finally {
      await session.close()
      await browser.close()
      await closeServers()
      let closeTimer
      const closed = await Promise.race([
        serverClosed.then(() => true),
        new Promise((resolve) => { closeTimer = setTimeout(() => resolve(false), shutdownTimeoutMs) }),
      ])
      clearTimeout(closeTimer)
      if (!closed) server.closeAllConnections?.()
    }
  })()
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('\nService failed to start:', e.message ?? e)
    process.exit(1)
  })
}
