import test from 'node:test'
import assert from 'node:assert/strict'
import {
  capabilities,
  lifecycleEditRequestSchema,
  projectCreateRequestSchema,
  projectSaveRequestSchema,
} from './lib/contract.mjs'

test('lifecycle project requests are strict and revision guarded', () => {
  assert.equal(
    projectCreateRequestSchema.safeParse({ name: 'Demo', surprise: true }).success,
    false,
  )
  assert.equal(projectSaveRequestSchema.safeParse({ project: {}, force: true }).success, true)
  assert.equal(projectSaveRequestSchema.safeParse({ project: {} }).success, false)
})

test('lifecycle edits require unique caller ids and accept id references', () => {
  const valid = lifecycleEditRequestSchema.safeParse({
    ops: [
      { callerId: 'create', op: 'addText', text: 'hello', from: 0 },
      { callerId: 'move', op: 'moveItem', id: { $ref: 'create#/detail/created/0/id' }, from: 4 },
    ],
  })
  assert.equal(valid.success, true, JSON.stringify(valid.error?.issues))
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [
        { callerId: 'same', op: 'addText', text: 'a', from: 0 },
        { callerId: 'same', op: 'addText', text: 'b', from: 1 },
      ],
    }).success,
    false,
  )
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [{ callerId: 'bad', op: 'addText', text: 'a', from: 0, surprise: true }],
    }).success,
    false,
  )
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [
        {
          callerId: 'bad',
          op: 'addText',
          text: { $ref: 'later#/detail/id' },
          from: 0,
        },
        { callerId: 'later', op: 'addText', text: 'later', from: 1 },
      ],
    }).success,
    false,
  )
})

test('capabilities publish lifecycle constraints', () => {
  const result = capabilities()
  assert.equal(result.lifecycle.httpMediaUpload, false)
  assert.equal(result.lifecycle.deleteProject, false)
  assert.equal(result.lifecycle.writerMode, 'exclusive')
  assert.ok(result.lifecycle.routes.includes('POST /v1/projects/:id/edit'))
})
