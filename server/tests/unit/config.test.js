'use strict';

const { loadConfig } = require('../../src/config');

const BASE_ENV = {
  NODE_ENV: 'test',
  APP_TARGET: 'api',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  QUEUE_NAME: 'client-provisioning',
};

describe('loadConfig', () => {
  test('returns a frozen config object for a valid env', () => {
    const cfg = loadConfig({ ...BASE_ENV });
    expect(cfg.port).toBe(3000);
    expect(cfg.appTarget).toBe('api');
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  test('throws when a required var is missing', () => {
    const env = { ...BASE_ENV };
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  test('throws on invalid APP_TARGET', () => {
    expect(() => loadConfig({ ...BASE_ENV, APP_TARGET: 'cron' })).toThrow(/APP_TARGET/);
  });

  test('throws on invalid PORT', () => {
    expect(() => loadConfig({ ...BASE_ENV, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...BASE_ENV, PORT: '0' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...BASE_ENV, PORT: '70000' })).toThrow(/PORT/);
  });
});
