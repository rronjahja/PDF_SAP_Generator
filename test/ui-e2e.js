/* Interactive UI smoke test (run with: node test/ui-e2e.js against a running server).
   Exercises: open designer -> create draft -> drag window -> drop palette window ->
   edit properties -> save -> run checks -> publish. */
const { chromium } = require('playwright');

(async () => {
  let exec;
  try {
    const C = require('@sparticuz/chromium').default;
    exec = await C.executablePath();
  } catch { /* fall back to playwright-managed browser */ }

  const browser = await chromium.launch({ headless: true, executablePath: exec, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const fs = require('fs');
  const log = (line) => { console.log(line); fs.appendFileSync('/tmp/ui-test.log', line + '\n'); };
  const step = async (name, fn) => {
    try { await fn(); log('PASS: ' + name); }
    catch (e) { log('FAIL: ' + name + ' — ' + e.message); process.exitCode = 1; }
  };

  await page.goto('http://localhost:4004/designer/', { waitUntil: 'networkidle' });

  await step('open designer', async () => {
    await page.click('text=Open designer');
    await page.waitForSelector('.sheet');
  });

  await step('create new draft version', async () => {
    await page.click('text=New draft version');
    await page.waitForSelector('.toolbar button:has-text("Publish")', { timeout: 8000 });
    if (await page.locator('.banner').count()) throw new Error('still locked');
  });

  await step('drag window A down by 52px', async () => {
    const before = await page.locator('[data-window="A"]').boundingBox();
    await page.mouse.move(before.x + 200, before.y + 40);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y + 40 + 52, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.locator('[data-window="A"]').boundingBox();
    if (Math.abs(after.y - before.y - 52) > 6) throw new Error(`moved ${after.y - before.y}px`);
  });

  await step('undo restores position', async () => {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
  });

  await step('drop a FREE SECTION window from the palette', async () => {
    const item = await page.locator('.palette-item', { hasText: 'Free section' }).boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10);
    await page.mouse.down();
    await page.mouse.move(sheet.x + 100, sheet.y + 740, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const tags = await page.locator('.win').count();
    if (tags !== 7) throw new Error(`expected 7 windows, found ${tags}`);
  });

  await step('properties panel shows the new window', async () => {
    const heading = await page.locator('.pform h4').innerText();
    if (!/Window/.test(heading)) throw new Error(`panel shows: ${heading}`);
  });

  await step('delete the new window again', async () => {
    await page.click('.pform button:has-text("Delete window")');
    await page.waitForTimeout(200);
    if ((await page.locator('.win').count()) !== 6) throw new Error('window not deleted');
  });

  await step('save draft', async () => {
    await page.click('.toolbar button:has-text("Save draft")');
    await page.waitForSelector('.toast.success', { timeout: 8000 });
  });

  await step('run checks reports valid', async () => {
    await page.click('text=Run checks');
    await page.waitForSelector('.issue.ok, .toast', { timeout: 20000 });
    const ok = await page.locator('.issue.ok').count();
    const errIssues = await page.locator('.issue.error').count();
    if (!ok && errIssues) throw new Error('checks reported errors');
  });

  await step('publish the draft', async () => {
    await page.click('.toolbar button:has-text("Publish")');
    await page.waitForSelector('.banner', { timeout: 10000 });
    const chip = await page.locator('.toolbar .chip').innerText();
    if (chip !== 'PUBLISHED') throw new Error(`chip says ${chip}`);
  });

  if (errors.length) {
    console.log('PAGE ERRORS:', errors.join(' | '));
    process.exitCode = 1;
  }
  await page.screenshot({ path: '/tmp/ui-final.png' });
  await browser.close();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
