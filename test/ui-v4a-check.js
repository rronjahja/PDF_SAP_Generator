/* v4 editor-feature checks: snap guides, blocks, datasets, live preview, visibleIf, assets. */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-v4a.log', l + '\n'); };
const step = async (name, fn) => {
  try { await fn(); log('PASS: ' + name); } catch (e) { log('FAIL: ' + name + ' — ' + e.message.split('\n')[0]); process.exitCode = 1; }
};

(async () => {
  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });

  await page.fill('input[placeholder^="New template name"]', 'v4a-' + Date.now());
  await page.click('text=Create template');
  await page.waitForSelector('.sheet');

  const dropWindow = async (label, dx, dy) => {
    const item = await page.locator('.palette-item', { hasText: label }).first().boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10); await page.mouse.down();
    await page.mouse.move(sheet.x + dx, sheet.y + dy, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(250);
  };

  await step('setup: two windows on the sheet', async () => {
    await dropWindow('Address', 120, 200);
    await dropWindow('Metadata', 360, 380);
    if ((await page.locator('.win').count()) !== 2) throw new Error('expected 2 windows');
  });

  await step('snap guide appears while dragging toward alignment', async () => {
    const wins = page.locator('.win');
    const a = await wins.nth(0).boundingBox();
    const b = await wins.nth(1).boundingBox();
    // drag window B horizontally toward window A's left edge
    await page.mouse.move(b.x + b.width / 2, b.y + 8); // grab via tag area is risky; use center top
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    // move so B's left edge approaches A's left edge (within 4pt)
    const targetX = a.x + (b.width / 2) + 2; // B center so left edges nearly align
    await page.mouse.move(targetX, b.y + b.height / 2 - 40, { steps: 10 });
    await page.waitForTimeout(150);
    const guides = await page.locator('.guide').count();
    await page.mouse.up();
    if (guides < 1) throw new Error('no guide line shown during drag');
  });

  await step('save window as reusable block', async () => {
    await page.dblclick('.win >> nth=0');
    await page.waitForSelector('.pform h4:has-text("Window")');
    page.once('dialog', (d) => d.accept('Test Block'));
    await page.click('button:has-text("Save as block")');
    await page.waitForSelector('.block-item:has-text("Test Block")');
  });

  await step('drop the block onto the sheet', async () => {
    const before = await page.locator('.win').count();
    const blockLoc = page.locator('.block-item .palette-item', { hasText: 'Test Block' });
    await blockLoc.scrollIntoViewIfNeeded();
    const item = await blockLoc.boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10); await page.mouse.down();
    await page.mouse.move(sheet.x + 250, sheet.y + 560, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(350);
    if ((await page.locator('.win').count()) !== before + 1) throw new Error('block did not create a window');
  });

  await step('dataset: save current data under a new name and switch back', async () => {
    await page.click('.tabs button:has-text("Data")');
    page.once('dialog', (d) => d.accept('big-order'));
    await page.click('.dataset-bar button:has-text("save as")');
    await page.waitForTimeout(200);
    const sel = page.locator('.dataset-bar select');
    if ((await sel.inputValue()) !== 'big-order') throw new Error('active dataset not switched');
    await sel.selectOption('default');
    await page.waitForTimeout(150);
    if ((await sel.inputValue()) !== 'default') throw new Error('switch back failed');
  });

  await step('visibleIf on a window shows the 👁 badge', async () => {
    await page.dblclick('.win >> nth=0');
    await page.waitForSelector('.pform h4:has-text("Window")');
    await page.fill('.pform input[placeholder="status == \'paid\'"]', 'total > 0');
    await page.waitForTimeout(200);
    if (!(await page.locator('.win-tag:has-text("👁")').count())) throw new Error('badge missing');
  });

  await step('live preview tab renders pages', async () => {
    await page.click('.tabs button:has-text("Preview")');
    await page.waitForTimeout(2500); // debounce + render
    const frame = page.frameLocator('.preview-frame');
    const pages = await frame.locator('.page').count();
    if (pages < 1) throw new Error('preview iframe has no rendered page');
  });

  await step('assets modal opens with upload control', async () => {
    await page.click('.toolbar button:has-text("Assets")');
    await page.waitForSelector('.dialog h3:has-text("Asset library")');
    if (!(await page.locator('.dialog button:has-text("Upload image")').count())) throw new Error('upload button missing');
    await page.click('.dialog-close');
  });

  await step('save draft persists everything', async () => {
    await page.click('.toolbar button:has-text("Save draft")');
    await page.waitForSelector('.toast.success');
  });

  await page.screenshot({ path: '/tmp/ui-v4a.png' });
  await browser.close();
  log('SUITE A DONE');
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
