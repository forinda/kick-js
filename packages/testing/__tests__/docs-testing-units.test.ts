/** The unit-test examples in docs/guide/testing/units.md, run as written. */
import { beforeEach, describe, expect, it } from 'vitest'
import { Autowired, Container, Inject, Service, Value, createToken, withEnv } from '@forinda/kickjs'

interface Invoice {
  id: string
  total: number
  paidAt: Date | null
}
interface InvoiceRepository {
  find(id: string): Promise<Invoice | null>
  save(invoice: Invoice): Promise<void>
}
const INVOICE_REPOSITORY = createToken<InvoiceRepository>('docs/Invoices/repository')
interface Clock {
  now(): Date
}
const CLOCK = createToken<Clock>('docs/Clock')

@Service()
class InvoiceService {
  constructor(
    @Inject(INVOICE_REPOSITORY) private readonly repo: InvoiceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async pay(id: string) {
    const invoice = await this.repo.find(id)
    if (!invoice) throw new Error(`No invoice ${id}`)
    if (invoice.paidAt) return invoice
    const paid = { ...invoice, paidAt: this.clock.now() }
    await this.repo.save(paid)
    return paid
  }
}

class InMemoryInvoices implements InvoiceRepository {
  readonly saved: Invoice[] = []
  constructor(private rows: Invoice[]) {}
  async find(id: string) {
    return this.rows.find((r) => r.id === id) ?? null
  }
  async save(invoice: Invoice) {
    this.saved.push(invoice)
  }
}

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) })

describe('unit tests', () => {
  it('constructs the service by hand', async () => {
    const repo = new InMemoryInvoices([{ id: 'i1', total: 10, paidAt: null }])
    const service = new InvoiceService(repo, fixedClock('2026-10-03T12:00:00Z'))
    const paid = await service.pay('i1')
    expect(paid.paidAt).toEqual(new Date('2026-10-03T12:00:00Z'))
    expect(repo.saved).toHaveLength(1)
  })

  describe('through the container', () => {
    beforeEach(() => Container.reset())

    it('resolves the service with fakes bound to its tokens', async () => {
      const container = Container.getInstance()
      container.registerInstance(
        INVOICE_REPOSITORY,
        new InMemoryInvoices([{ id: 'i1', total: 10, paidAt: null }]),
      )
      container.registerInstance(CLOCK, fixedClock('2026-01-01T00:00:00Z'))
      const service = container.resolve(InvoiceService)
      expect((await service.pay('i1')).paidAt?.getUTCFullYear()).toBe(2026)
    })
  })

  describe('property injection and config values', () => {
    beforeEach(() => Container.reset())

    @Service()
    class ClockHolder {
      year() {
        return 2026
      }
    }
    void ClockHolder

    @Service()
    class Greeter {
      @Value('GREETING') greeting!: string
      @Autowired() clockHolder!: ClockHolder
      greet(name: string) {
        return `${this.greeting}, ${name} (${this.clockHolder.year()})`
      }
    }

    it('reads @Value through withEnv', async () => {
      const greeter = Container.getInstance().resolve(Greeter)
      const text = await withEnv({ GREETING: 'Habari' }, () => greeter.greet('Ada'))
      expect(text).toBe('Habari, Ada (2026)')
    })
  })
})
