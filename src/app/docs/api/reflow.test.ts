import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const source = readFileSync('src/app/docs/api/page.tsx', 'utf8');
test('API prose tokens, webhook cells and operation summaries can reflow without clipping', () => {
  expect(source).toContain('[&_code]:[overflow-wrap:anywhere]');
  expect(source).not.toContain('whitespace-nowrap');
  expect(source).toContain('table-fixed');
  expect(source).toContain('select-none [overflow-wrap:anywhere]');
  expect(source).toContain('<pre tabIndex={0}');
  expect(source).toContain('overflow-x-auto');
  expect(source).not.toMatch(/overflow-x-hidden|text-\[1[0-3]px\]/);
});
