import { describe, it, expect } from 'vitest';

import { formatPercent, formatSeconds, formatDateTime } from './format';

describe('formatPercent', () => {
  it('rounds a ratio to the nearest integer percentage', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.333)).toBe('33%');
    expect(formatPercent(0.666)).toBe('67%');
  });

  it('returns — for non-finite inputs', () => {
    expect(formatPercent(NaN)).toBe('—');
    expect(formatPercent(Infinity)).toBe('—');
    expect(formatPercent(-Infinity)).toBe('—');
  });
});

describe('formatSeconds', () => {
  it('formats sub-second durations as <1s', () => {
    expect(formatSeconds(0)).toBe('<1s');
    expect(formatSeconds(0.5)).toBe('<1s');
    expect(formatSeconds(0.999)).toBe('<1s');
  });

  it('formats whole seconds under a minute', () => {
    expect(formatSeconds(1)).toBe('1s');
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(59)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatSeconds(60)).toBe('1m');
    expect(formatSeconds(90)).toBe('1m 30s');
    expect(formatSeconds(135)).toBe('2m 15s');
    expect(formatSeconds(120)).toBe('2m');
  });

  it('returns — for negative or non-finite inputs', () => {
    expect(formatSeconds(-1)).toBe('—');
    expect(formatSeconds(NaN)).toBe('—');
    expect(formatSeconds(Infinity)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('returns a non-empty string for a valid ISO date', () => {
    const result = formatDateTime('2026-04-20T12:00:00.000Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for an unparseable input', () => {
    // new Date('invalid').toLocaleString() does not throw — it returns
    // a locale-specific "Invalid Date" string rather than the original input.
    const result = formatDateTime('not-a-date');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
