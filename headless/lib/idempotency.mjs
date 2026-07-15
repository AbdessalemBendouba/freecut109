import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, withResourceLock } from './lifecycle-store.mjs'
import { HttpError } from './http-security.mjs'

const TTL_MS = 24 * 60 * 60 * 1000

export function validateIdempotencyKey(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw new HttpError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key must be 1-128 printable ASCII characters',
    )
  }
  return value
}

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

export async function withIdempotency(workspace, { key, method, route, requestBytes }, operation) {
  validateIdempotencyKey(key)
  const dir = path.join(workspace, '.freecut-headless', 'idempotency')
  const file = path.join(dir, `${hash(key)}.json`)
  const requestHash = hash(requestBytes)
  return withResourceLock(`idempotency:${hash(key)}`, async () => {
    let existing
    try {
      existing = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (existing && Date.now() - existing.createdAt <= TTL_MS) {
      if (
        existing.method !== method ||
        existing.route !== route ||
        existing.requestHash !== requestHash
      ) {
        throw new HttpError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was used for a different request',
        )
      }
      if (existing.state === 'complete')
        return { replayed: true, status: existing.status, response: existing.response }
      throw new HttpError(
        409,
        'IDEMPOTENCY_INDETERMINATE',
        'A previous request with this key may have committed',
      )
    }
    await fs.promises.mkdir(dir, { recursive: true })
    const pending = {
      method,
      route,
      requestHash,
      state: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await atomicWriteFile(file, Buffer.from(`${JSON.stringify(pending, null, 2)}\n`))
    let result
    try {
      result = await operation()
    } catch (error) {
      await fs.promises.rm(file, { force: true }).catch(() => {})
      throw error
    }
    const complete = {
      ...pending,
      state: 'complete',
      updatedAt: Date.now(),
      status: result.status,
      response: result.response,
    }
    await atomicWriteFile(file, Buffer.from(`${JSON.stringify(complete, null, 2)}\n`))
    return { replayed: false, ...result }
  })
}
