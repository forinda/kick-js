import { describe, expect, it } from 'vitest'
import { RAW_BODY } from '../src/index'
import { rejectUnsupportedBody } from '../src/http/body-policy'

describe('rejectUnsupportedBody and RAW_BODY', () => {
  const run = (req: Record<string | symbol, unknown>) =>
    new Promise<unknown>((done) => rejectUnsupportedBody()(req, {}, done))
  const upload = () => ({
    method: 'PATCH',
    headers: { 'content-type': 'application/offset+octet-stream', 'content-length': '3' },
  })

  it('answers 415 for a body type nothing parses', async () => {
    expect(await run(upload())).toMatchObject({ status: 415 })
  })

  it('leaves a body claimed by later middleware alone', async () => {
    expect(await run({ ...upload(), [RAW_BODY]: true })).toBeUndefined()
    expect(RAW_BODY).toBe(Symbol.for('kick/http/raw-body'))
  })
})
