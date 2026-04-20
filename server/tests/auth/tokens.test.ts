/**
 * Unit tests for the JWT sign/verify helpers.
 *
 * Focus is the failure taxonomy: the auth middleware collapses every
 * jsonwebtoken failure into a single `InvalidTokenError`, and these tests
 * pin that collapse so a future refactor cannot accidentally let a raw
 * `TokenExpiredError` or `JsonWebTokenError` leak through.
 */

import jwt from 'jsonwebtoken';

import { InvalidTokenError, signToken, verifyToken } from '../../src/auth/tokens';
import { makeTestConfig } from '../helpers/config';

const config = makeTestConfig();

describe('signToken + verifyToken roundtrip', () => {
  it('preserves the sub and email claims', () => {
    const payload = {
      sub: '00000000-0000-0000-0000-000000000001',
      email: 'admin@onboarding.local',
    };
    const token = signToken(payload, config);
    const decoded = verifyToken(token, config);
    expect(decoded).toEqual(payload);
  });
});

describe('verifyToken — failure modes', () => {
  const payload = {
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'admin@onboarding.local',
  };

  it('throws InvalidTokenError when the signature is wrong', () => {
    const token = signToken(payload, config);
    // Flip the last character of the signature to invalidate it deterministically.
    const bad = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(() => verifyToken(bad, config)).toThrow(InvalidTokenError);
  });

  it('throws InvalidTokenError under a different secret', () => {
    const token = signToken(payload, config);
    const wrongSecret = makeTestConfig({
      jwtSecret: 'some-other-thirty-two-plus-char-secret-xxxx',
    });
    expect(() => verifyToken(token, wrongSecret)).toThrow(InvalidTokenError);
  });

  it('throws InvalidTokenError for a clearly malformed token', () => {
    expect(() => verifyToken('not.a.jwt', config)).toThrow(InvalidTokenError);
  });

  it('throws InvalidTokenError when the payload has no sub claim', () => {
    // Hand-craft a token missing the sub claim to exercise the claim-shape guard.
    const token = jwt.sign({ email: 'x@y.z' }, config.jwtSecret);
    expect(() => verifyToken(token, config)).toThrow(InvalidTokenError);
  });
});
