import { readFileSync } from 'node:fs';

const responsiveCss = readFileSync(
  new URL('../../src/ui/tokens/responsive.css', import.meta.url),
  'utf8'
);

describe('responsive foundation contract', () => {
  it('defines safe viewport primitives for every PWA shell', () => {
    expect(responsiveCss).toContain('--viewport-block-size');
    expect(responsiveCss).toContain('--viewport-inline-size');
    expect(responsiveCss).toContain('env(safe-area-inset-top');
    expect(responsiveCss).toContain('100dvh');
  });

  it('provides shared compact-height and landscape hooks without changing logic', () => {
    expect(responsiveCss).toContain('@media (orientation: landscape)');
    expect(responsiveCss).toContain('@media (max-height: 700px)');
    expect(responsiveCss).toContain('.pwa-shell');
  });
});
