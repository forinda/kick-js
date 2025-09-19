export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  level?: LogLevel;
}

export interface AppLogger {
  readonly level: LogLevel;
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class ConsoleLogger implements AppLogger {
  public readonly level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.log('error', message, metadata);
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    if (!this.shouldLog(level)) {
      return;
    }

    const payload = metadata ? [message, metadata] : [message];
    switch (level) {
      case 'debug':
        console.debug(...payload);
        break;
      case 'info':
        console.info(...payload);
        break;
      case 'warn':
        console.warn(...payload);
        break;
      case 'error':
        console.error(...payload);
        break;
    }
  }

  private shouldLog(level: LogLevel) {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.level];
  }
}

export function createLogger(config: LoggerConfig = {}): AppLogger {
  return new ConsoleLogger(config.level);
}
