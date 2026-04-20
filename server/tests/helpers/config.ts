/**
 * Test-time AppConfig builder.
 *
 * Bypasses `loadConfig()` so tests do not need a real process.env and do not
 * pay the production bcrypt cost (the validator enforces >=12). Every field
 * is still the shape the real config exports — the type system guarantees we
 * stay in sync if AppConfig grows a new field.
 *
 * Tests that need to toggle a single value pass an override; nothing else
 * should mutate the returned object (it is frozen, mirroring loadConfig).
 */

import type { AppConfig } from '../../src/config/index.js';

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return Object.freeze({
    nodeEnv: 'test',
    appTarget: 'api',
    port: 4000,
    logLevel: 'error',
    databaseUrl: 'postgres://test',
    redisUrl: 'redis://test',
    queueName: 'test-queue',
    jwtSecret: 'test-secret-at-least-thirty-two-chars-long-xx',
    bcryptCostFactor: 4,
    portalBaseUrl: 'http://test.local/portal',
    corsAllowedOrigins: Object.freeze(['http://test.local']),
    ...overrides,
  });
}
