import type { Logger } from '@nestjs/common';
import { loadConfig } from '../../config/config';

type Level = 'log' | 'warn' | 'error';

/**
 * Structured event logging. In JSON mode (staging/production) the event object is
 * nested as `message`, so log collectors can index its fields; in pretty mode
 * (development) it is printed as a compact single line.
 */
export function logEvent(logger: Logger, level: Level, event: Record<string, unknown>) {
  if (loadConfig().LOG_FORMAT === 'json') logger[level](event);
  else logger[level](JSON.stringify(event));
}
