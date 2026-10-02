import { describe, expect, it } from 'vitest'
import { RequestLog } from '../src/request-log'

const res = (requestId: string, status = 200) => ({
  method: 'GET',
  path: `/x/${requestId}`,
  route: '/x/:id',
  status,
  durationMs: 3,
  requestId,
})

describe('RequestLog', () => {
  it('keeps the last N entries and returns those after a seq', () => {
    const log = new RequestLog(2)
    log.record(res('a'))
    log.record(res('b'))
    log.record(res('c'))
    expect(log.after().map((e) => e.requestId)).toEqual(['b', 'c'])
    expect(log.after(2).map((e) => e.requestId)).toEqual(['c'])
  })

  it('attaches an error whichever hook fires first', () => {
    const log = new RequestLog(10)
    log.recordError('early', new TypeError('bad input'))
    log.record(res('early', 500))
    log.record(res('late', 500))
    log.recordError('late', 'boom')
    const [early, late] = log.after()
    expect(early!.error).toEqual({ name: 'TypeError', message: 'bad input' })
    expect(late!.error).toEqual({ name: 'Error', message: 'boom' })
  })

  it('records nothing with capacity 0', () => {
    const log = new RequestLog(0)
    log.record(res('a'))
    log.recordError('a', new Error('x'))
    expect(log.after()).toEqual([])
  })
})
