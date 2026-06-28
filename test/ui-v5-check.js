/* v5 paint-mode checks. */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-v5.log', l + '\n'); };
const step = async (name, fn) => {
  try { await fn(); log('PASS: ' + name); } catch (e) { log('FAIL: ' + name + ' — ' + e.message.split('\n')[0]); process.exitCode = 1; }
};

(async () => {
  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });

  await page.fill('input[placeholder^="New template name"]', 'v5-' + Date.now());
  await page.click('text=Create template');
  await page.waitForSelector('.sheet');

  const drop = async (label, dx, dy) => {
    const item = await page.locator('.palette-item', { hasText: label }).first().boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10); await page.mouse.down();
    await page.mouse.move(sheet.x + dx, sheet.y + dy, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(250);
  };
  await drop('Free section', 250, 220);

  await step('paint mode opens with the swatch palette', async () => {
    await page.click('.toolbar button:has-text("Paint")');
    await page.waitForSelector('.paintbar');
    if ((await page.locator('.paintbar .swatch').count()) < 15) throw new Error('swatches missing');
  });

  await step('clicking a window fills its background', async () => {
    await page.click('.paintbar .swatch[title="#f2c94c"]');
    await page.click('.win');
    await page.waitForTimeout(200);
    const bg = await page.locator('.win').evaluate((n) => getComputedStyle(n).backgroundColor);
    if (!bg.includes('242, 201, 76')) throw new Error('window background not painted: ' + bg);
  });

  await step('painted color lands in the layout JSON (undoable)', async () => {
    // properties should reflect it after exiting paint mode
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    if (await page.locator('.paintbar').count()) throw new Error('Esc did not exit paint mode');
    await page.dblclick('.win');
    await page.waitForSelector('.pform h4:has-text("Window")');
    const v = await page.locator('.pform input[type="color"]').first().inputValue();
    if (v.toLowerCase() !== '#f2c94c') throw new Error('background not in properties: ' + v);
  });

  await step('clicking empty paper paints the page background', async () => {
    await page.click('.toolbar button:has-text("Paint")');
    await page.click('.paintbar .swatch[title="#eef3fa"]');
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.click(sheet.x + 40, sheet.y + 40); // top-left corner: visible and empty
    await page.waitForTimeout(200);
    const bg = await page.locator('.sheet').evaluate((n) => getComputedStyle(n).backgroundColor);
    if (!bg.includes('238, 243, 250')) throw new Error('page not painted: ' + bg);
  });

  await step('eraser clears the window fill', async () => {
    await page.click('.paintbar .swatch.eraser');
    await page.click('.win');
    await page.waitForTimeout(200);
    const bg = await page.locator('.win').evaluate((n) => getComputedStyle(n).backgroundColor);
    if (bg.includes('242, 201, 76')) throw new Error('fill not erased: ' + bg);
  });

  await step('recent colors appear in the bar', async () => {
    if ((await page.locator('.paintbar .swatch[title="#f2c94c"]').count()) < 2) throw new Error('recent swatch missing');
  });

  await step('undo reverts the paint actions', async () => {
    await page.click('.paintbar button:has-text("Done")');
    await page.click('.toolbar button:has-text("Undo")'); // erase
    await page.click('.toolbar button:has-text("Undo")'); // page bg
    await page.waitForTimeout(200);
    const bg = await page.locator('.win').evaluate((n) => getComputedStyle(n).backgroundColor);
    if (!bg.includes('242, 201, 76')) throw new Error('undo did not restore the fill: ' + bg);
  });

  await step('page background reaches the rendered preview', async () => {
    await page.click('.toolbar button:has-text("Redo")'); // restore the page background undone above
    await page.waitForTimeout(150);
    await page.click('.tabs button:has-text("Preview")');
    await page.waitForTimeout(2500);
    const html = await page.frameLocator('.preview-frame').locator('.page').first().getAttribute('style');
    if (!html || !html.includes('background:#eef3fa')) throw new Error('page bg missing in render: ' + html);
  });

  await page.screenshot({ path: '/tmp/ui-v5.png' });
  await browser.close();
  log('SUITE DONE');
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
