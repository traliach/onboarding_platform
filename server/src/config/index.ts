/**
 * Environment variable validation — runs on every process startup.
 *
 * The server (API or worker) refuses to start if any required variable is
 * missing, malformed, or outside the allowed range. Validation happens here
 * and nowhere else — no runtime re-parsing, no `process.env.X ?? ''` anywhere
 * in the rest of the codebase. Import the frozen `AppConfig` value returned
 * by `loadConfig()` and pass it down explicitly.
 *
 * Validation rules come directly from project rules sections 6 and 10.
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type AppTarget = 'api' | 'worker';
export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'debug';

const NODE_ENVS = ['development', 'test', 'production'] as const satisfies readonly NodeEnv[];
const APP_TARGETS = ['api', 'worker'] as const satisfies readonly AppTarget[];
const LOG_LEVELS = [
  'error',
  'warn',
  'info',
  'http',
  'debug',
] as const satisfies readonly LogLevel[];

const JWT_SECRET_MIN_LENGTH = 32;
const BCRYPT_COST_MIN = 12;
const BCRYPT_COST_MAX = 15;
const PORT_MIN = 1;
const PORT_MAX = 65535;

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly appTarget: AppTarget;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly queueName: string;
  readonly jwtSecret: string;
  readonly bcryptCostFactor: number;
  readonly portalBaseUrl: string;
  readonly corsAllowedOrigins: readonly string[];
}

export class ConfigValidationError extends Error {
  public readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

function isOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseIntegerInRange(
  value: string | undefined,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === '') {
    return null;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max || String(n) !== value.trim()) {
    return null;
  }
  return n;
}

function parseCsvOrigins(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function validateUrlPrefix(
  value: string | undefined,
  allowedPrefixes: readonly string[],
): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  return allowedPrefixes.some((prefix) => value.startsWith(prefix));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  const nodeEnv = env.NODE_ENV;
  if (!isOneOf(nodeEnv, NODE_ENVS)) {
    errors.push(
      `NODE_ENV must be one of: ${NODE_ENVS.join(', ')} (got: ${nodeEnv ?? 'undefined'})`,
    );
  }

  const appTarget = env.APP_TARGET;
  if (!isOneOf(appTarget, APP_TARGETS)) {
    errors.push(
      `APP_TARGET must be one of: ${APP_TARGETS.join(', ')} (got: ${appTarget ?? 'undefined'})`,
    );
  }

  const port = parseIntegerInRange(env.PORT, PORT_MIN, PORT_MAX);
  if (port === null) {
    errors.push(`PORT must be an integer between ${PORT_MIN} and ${PORT_MAX}`);
  }

  const logLevel = env.LOG_LEVEL;
  if (!isOneOf(logLevel, LOG_LEVELS)) {
    errors.push(
      `LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')} (got: ${logLevel ?? 'undefined'})`,
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (!validateUrlPrefix(databaseUrl, ['postgres://', 'postgresql://'])) {
    errors.push('DATABASE_URL must be a postgres:// or postgresql:// URL');
  }

  const redisUrl = env.REDIS_URL;
  if (!validateUrlPrefix(redisUrl, ['redis://', 'rediss://'])) {
    errors.push('REDIS_URL must be a redis:// or rediss:// URL');
  }

  const queueName = env.QUEUE_NAME;
  if (typeof queueName !== 'string' || queueName.length === 0) {
    errors.push('QUEUE_NAME must be a non-empty string');
  }

  const jwtSecret = env.JWT_SECRET;
  if (typeof jwtSecret !== 'string' || jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    errors.push(
      `JWT_SECRET must be a string of at least ${JWT_SECRET_MIN_LENGTH} characters (section 10)`,
    );
  }

  const bcryptCostFactor = parseIntegerInRange(
    env.BCRYPT_COST_FACTOR,
    BCRYPT_COST_MIN,
    BCRYPT_COST_MAX,
  );
  if (bcryptCostFactor === null) {
    errors.push(
      `BCRYPT_COST_FACTOR must be an integer between ${BCRYPT_COST_MIN} and ${BCRYPT_COST_MAX} (section 10)`,
    );
  }

  const portalBaseUrl = env.PORTAL_BASE_URL;
  if (!validateUrlPrefix(portalBaseUrl, ['http://', 'https://'])) {
    errors.push('PORTAL_BASE_URL must be an http:// or https:// URL');
  }

  const corsAllowedOrigins = parseCsvOrigins(env.CORS_ALLOWED_ORIGINS);
  if (corsAllowedOrigins.length === 0) {
    errors.push(
      'CORS_ALLOWED_ORIGINS must contain at least one origin (section 10 — no wildcard)',
    );
  }
  const wildcard = corsAllowedOrigins.find((o) => o === '*');
  if (wildcard !== undefined) {
    errors.push('CORS_ALLOWED_ORIGINS must not contain "*" (section 10)');
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return Object.freeze({
    nodeEnv: nodeEnv as NodeEnv,
    appTarget: appTarget as AppTarget,
    port: port as number,
    logLevel: logLevel as LogLevel,
    databaseUrl: databaseUrl as string,
    redisUrl: redisUrl as string,
    queueName: queueName as string,
    jwtSecret: jwtSecret as string,
    bcryptCostFactor: bcryptCostFactor as number,
    portalBaseUrl: portalBaseUrl as string,
    corsAllowedOrigins: Object.freeze([...corsAllowedOrigins]),
  });
}
