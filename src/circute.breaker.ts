import { Logger } from '@nestjs/common';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerConfig {
  failureThreshold: number; // Percentage (0-1)
  windowSize: number; // Number of requests to track
  cooldownMs: number; // Cooldown period in milliseconds
  halfOpenProbes: number; // Number of test requests in half-open state
}

interface RequestRecord {
  success: boolean;
  timestamp: number;
}

export class CircuitBreaker {
  private readonly logger = new Logger(`CircuitBreaker`);
  private state: CircuitState = CircuitState.CLOSED;
  private requestHistory: RequestRecord[] = [];
  private openedAt: number | null = null;
  private halfOpenAttempts: number = 0;

  constructor(
    private config: CircuitBreakerConfig,
  ) {
  }

  async execute<T>(
    operation: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      this.logger.debug(`openAt: ${this.openedAt}, now: ${now}, cooldownMs: ${this.config.cooldownMs}`);
      if (this.openedAt && now - this.openedAt >= this.config.cooldownMs) {

        this.logger.log(`State transition: OPEN -> HALF_OPEN (cooldown passed)`);
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenAttempts = 0;
      } else {
        this.logger.warn(`Circuit OPEN, using fallback`);
        return fallback();
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenProbes) {
        return fallback();
      }
      this.halfOpenAttempts++;
      this.logger.log(`Half-open probe attempt ${this.halfOpenAttempts}/${this.config.halfOpenProbes}`);
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.logger.error(`Operation failed: ${error.message}`);
      this.recordFailure();
      return fallback();
    }
  }

  private recordSuccess(): void {
    this.requestHistory.push({ success: true, timestamp: Date.now() });

    // Only store 20 redords
    this.trimHistory();

    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.log(`State transition: HALF_OPEN -> CLOSED (probe succeeded)`);
      this.state = CircuitState.CLOSED;
      this.halfOpenAttempts = 0;
      this.requestHistory = [];
    } else if (this.state === CircuitState.CLOSED) {
      this.logger.debug(`Request succeeded in CLOSED state`);
    }
  }

  private recordFailure(): void {
    this.requestHistory.push({ success: false, timestamp: Date.now() });
    this.trimHistory();

    const failureRate = this.calculateFailureRate();
    
    if (
      this.state === CircuitState.CLOSED &&
      failureRate >= this.config.failureThreshold &&
      this.requestHistory.length >= this.config.windowSize
    ) {
      this.openCircuit();
    } else if (this.state === CircuitState.HALF_OPEN && this.halfOpenAttempts >= this.config.halfOpenProbes) {
      this.logger.warn(`State transition: HALF_OPEN -> OPEN (probe failed)`);
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.state = CircuitState.OPEN;
    this.openedAt = Date.now();
  }

  private calculateFailureRate(): number {
    if (this.requestHistory.length === 0) return 0;

    const failures = this.requestHistory.filter((r) => !r.success).length;
    return failures / this.requestHistory.length;
  }

  private trimHistory(): void {
    if (this.requestHistory.length > this.config.windowSize) {
      this.requestHistory = this.requestHistory.slice(-this.config.windowSize);
    }
  }

  getState(): string {
    return this.state;
  }

  getStats() {
    const total = this.requestHistory.length;
    const failures = this.requestHistory.filter((r) => !r.success).length;
    const successes = total - failures;

    return {
      state: this.state,
      total,
      successes,
      failures,
      failureRate: total > 0 ? ((failures / total) * 100).toFixed(2) + '%' : '0%',
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      halfOpenAttempts: this.halfOpenAttempts,
      coolDownMs: this.config.cooldownMs,
    };
  }
}

function fallback(): void {
    throw new Error('Function not implemented.');
}
