/* Slim check for the window-drag fix only (full suite: ui-e2e.js). */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-drag.log', l + '\n'); };

(async () => {
  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });
  await page.click('text=Open designer');
  await page.waitForSelector('.sheet');
  log('opened designer');
  await page.click('text=New draft version');
  await page.waitForSelector('.toolbar button:has-text("Publish")');
  log('draft created');
  const before = await page.locator('[data-window="A"]').boundingBox();
  await page.mouse.move(before.x + 200, before.y + 40);
  await page.mouse.down();
  await page.mouse.move(before.x + 200, before.y + 40 + 52, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.locator('[data-window="A"]').boundingBox();
  const moved = after.y - before.y;
  log(Math.abs(moved - 52) <= 6 ? `PASS: drag moved ${moved}px` : `FAIL: drag moved ${moved}px`);
  await browser.close();
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
