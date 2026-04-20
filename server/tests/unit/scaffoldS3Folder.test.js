'use strict';

const {
  scaffoldS3Folder,
  STEP_NAME,
  STEP_ORDER,
  slugify,
} = require('../../src/worker/steps/scaffoldS3Folder');
const { fakeLogger } = require('../helpers/fakeLogger');

describe('scaffoldS3Folder step', () => {
  test('exports correct metadata', () => {
    expect(STEP_NAME).toBe('scaffoldS3Folder');
    expect(STEP_ORDER).toBe(2);
  });

  test('slugify normalises company names', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
    expect(slugify('  Foo  Bar  ')).toBe('foo-bar');
    expect(slugify('Weird/Name!!')).toBe('weird-name');
  });

  test('prefix uses company when present', async () => {
    const logger = fakeLogger();
    const result = await scaffoldS3Folder({
      client: { id: 'c-1', name: 'X', company: 'Acme Corp' },
      logger,
    });
    expect(result.mockedPrefix).toBe('clients/acme-corp/');
  });

  test('falls back to name when company missing', async () => {
    const logger = fakeLogger();
    const result = await scaffoldS3Folder({
      client: { id: 'c-1', name: 'Jane Doe' },
      logger,
    });
    expect(result.mockedPrefix).toBe('clients/jane-doe/');
  });
});
