import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const pageUrl = new URL('../docs/index.html', import.meta.url).href;
const browser = await chromium.launch({
  channel: process.env.JOINTALLY_CHROME_CHANNEL || undefined,
});
try {
  const context = await browser.newContext({ offline: true, viewport: { width: 1360, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  const network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  const field = id => page.locator('#' + id);
  const shows = async (id, value) => assert.equal(await field(id).innerText(), value);
  const fitsViewport = async () => assert.ok(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth), 'Page should fit the viewport');

  await page.goto(pageUrl);
  await shows('before', '10,316.00');
  await shows('after', '19,766.00');
  await shows('delta', '+9,450.00');
  await shows('output-rows', '18');
  if (process.argv.includes('--screenshot')) {
    const path = fileURLToPath(new URL('../docs/workbench.png', import.meta.url));
    await page.screenshot({ path, fullPage: true });
  }
  await field('region-key').click();
  await shows('delta', '0.00');
  await shows('output-rows', '10');
  const downloading = page.waitForEvent('download');
  await field('export').click();
  const download = await downloading;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.report.after, '10316.00');
  assert.equal(exported.report.hasDrift, false);
  assert.equal(exported.report.unmatchedLeft, 1);
  assert.equal(exported.options.keys.length, 2);

  await page.goto(pageUrl + '#balanced');
  await shows('before', '250.00');
  await shows('after', '250.00');
  await shows('output-rows', '3');
  await shows('repeated', '100.00');
  await shows('dropped', '100.00');
  assert.ok(await field('offset-detail').isVisible());

  await field('import').click();
  await field('left-text').fill('id,amount\na,1.25\nb,2.25\n');
  await field('right-text').fill('key,key\na,a');
  await field('load').click();
  assert.ok(await field('import-error').isVisible());
  await field('right-text').fill('key\na\na\nc\n');
  await field('load').click();
  await shows('after', '4.75');
  await shows('delta', '+1.25');
  await page.locator('input[value="inner"]').check();
  await shows('after', '2.50');
  await shows('delta', '−1.00');

  await field('import').click();
  for (const [side, csv] of [
    ['left', 'account,price\r\n"a\r\nb",0.10\r\n"a\nb",0.20\r\n'],
    ['right', 'account\r\n"a\r\nb"\r\n"a\r\nb"\r\n'],
  ]) {
    await field(side + '-file').setInputFiles({ name: side + '.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  }
  await field('load').click();
  await shows('before', '0.30');
  await shows('after', '0.40');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl);
  await fitsViewport();
  await field('toggle-settings').click();
  assert.equal(await field('toggle-settings').getAttribute('aria-expanded'), 'true');
  await field('example').selectOption('balanced');
  await shows('after', '250.00');
  await fitsViewport();
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log('Offline Chromium checks passed for both demos, composite keys, JSON export, pasted and uploaded CSVs, and mobile layout.');
} finally {
  await browser.close();
}
