/**
 * Circuit Breaker pattern for external service calls.
 *
 * Protects your application from cascading failures when downstream
 * services are unhealthy by short-circuiting requests after a
 * configurable failure threshold.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker('payment-api', {
 *   failureThreshold: 5,
 *   resetTimeout: 30_000,
 * })
 *
 * const result = await breaker.execute(() => fetch('https://payment.example.com/charge'))
 * ```
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half_open'

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. */
  failureThreshold: number
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN. */
  resetTimeout: number
  /** Max requests allowed in HALF_OPEN state before deciding (default 1). */
  halfOpenMax?: number
}

export interface CircuitBreakerStats {
  failures: number
  successes: number
  state: CircuitBreakerState
  lastFailure?: Date
}

/**
 * Error thrown when the circuit is open and calls are being rejected.
 */
export class CircuitOpenError extends Error {
  constructor(public readonly breakerName: string) {
    super(`Circuit breaker "${breakerName}" is open — request rejected`)
    this.name = 'CircuitOpenError'
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed'
  private failures = 0
  private successes = 0
  private halfOpenAttempts = 0
  private lastFailure?: Date
  private openedAt?: number

  private readonly failureThreshold: number
  private readonly resetTimeout: number
  private readonly halfOpenMax: number

  constructor(
    public readonly name: string,
    options: CircuitBreakerOptions,
  ) {
    this.failureThreshold = options.failureThreshold
    this.resetTimeout = options.resetTimeout
    this.halfOpenMax = options.halfOpenMax ?? 1
  }

  /**
   * Execute an async function through the circuit breaker.
   * Throws `CircuitOpenError` if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen()

    if (this.state === 'open') {
      throw new CircuitOpenError(this.name)
    }

    if (this.state === 'half_open' && this.halfOpenAttempts >= this.halfOpenMax) {
      throw new CircuitOpenError(this.name)
    }

    if (this.state === 'half_open') {
      this.halfOpenAttempts++
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  /** Returns the current circuit state. */
  getState(): CircuitBreakerState {
    this.maybeTransitionToHalfOpen()
    return this.state
  }

  /** Returns current statistics. */
  getStats(): CircuitBreakerStats {
    this.maybeTransitionToHalfOpen()
    return {
      failures: this.failures,
      successes: this.successes,
      state: this.state,
      ...(this.lastFailure ? { lastFailure: this.lastFailure } : {}),
    }
  }

  /** Manually reset the circuit breaker to CLOSED state. */
  reset(): void {
    this.state = 'closed'
    this.failures = 0
    this.successes = 0
    this.halfOpenAttempts = 0
    this.lastFailure = undefined
    this.openedAt = undefined
  }

  private onSuccess(): void {
    if (this.state === 'half_open') {
      // Recovery confirmed — close the circuit
      this.state = 'closed'
      this.failures = 0
      this.halfOpenAttempts = 0
      this.openedAt = undefined
    }
    this.successes++
  }

  private onFailure(): void {
    this.failures++
    this.lastFailure = new Date()

    if (this.state === 'half_open') {
      // Recovery failed — re-open
      this.state = 'open'
      this.openedAt = Date.now()
      this.halfOpenAttempts = 0
    } else if (this.state === 'closed' && this.failures >= this.failureThreshold) {
      this.state = 'open'
      this.openedAt = Date.now()
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state === 'open' && this.openedAt != null) {
      if (Date.now() - this.openedAt >= this.resetTimeout) {
        this.state = 'half_open'
        this.halfOpenAttempts = 0
      }
    }
  }
}
