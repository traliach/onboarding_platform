/**
 * Unit tests for the bcrypt password helpers.
 *
 * Uses cost factor 4 (the bcrypt minimum) so the full suite runs in well
 * under a second. Production config enforces cost 12 via the validator;
 * correctness is orthogonal to cost, so these tests exercise the contract.
 */

import { hashPassword, verifyPassword } from '../../src/auth/passwords';
import { makeTestConfig } from '../helpers/config';

const config = makeTestConfig();

describe('hashPassword', () => {
  it('returns a bcrypt-shaped hash for a non-empty password', async () => {
    const hash = await hashPassword('correct horse battery staple', config);
    // $2b$ (or $2a$/$2y$) algorithm prefix, then cost, then salt+hash.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
  });

  it('rejects an empty password', async () => {
    await expect(hashPassword('', config)).rejects.toThrow(/non-empty/);
  });

  it('produces a different hash on each call (salt is random)', async () => {
    const h1 = await hashPassword('same-input', config);
    const h2 = await hashPassword('same-input', config);
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('returns true for the original plaintext against its hash', async () => {
    const hash = await hashPassword('s3cret', config);
    await expect(verifyPassword('s3cret', hash)).resolves.toBe(true);
  });

  it('returns false for the wrong plaintext', async () => {
    const hash = await hashPassword('s3cret', config);
    await expect(verifyPassword('S3cret', hash)).resolves.toBe(false);
  });

  it('returns false (never throws) for a malformed stored hash', async () => {
    await expect(verifyPassword('anything', 'not-a-real-bcrypt-hash')).resolves.toBe(
      false,
    );
  });

  it('returns false for an empty candidate', async () => {
    const hash = await hashPassword('s3cret', config);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });
});
