/* v4 workflow checks: QR in preview, asset picker, review lifecycle, history, compare. */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-v4b.log', l + '\n'); };
const step = async (name, fn) => {
  try { await fn(); log('PASS: ' + name); } catch (e) { log('FAIL: ' + name + ' — ' + e.message.split('\n')[0]); process.exitCode = 1; }
};
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  // seed an asset via the API so the picker has something to pick
  await fetch('http://localhost:4004/api/v1/assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'logo-test.png', mimeType: 'image/png', contentBase64: PNG1 })
  });

  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(9000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });

  await page.fill('input[placeholder^="New template name"]', 'v4b-' + Date.now());
  await page.click('text=Create template');
  await page.waitForSelector('.sheet');

  await step('setup: window with QR and image elements', async () => {
    const item = await page.locator('.palette-item', { hasText: 'Free section' }).boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10); await page.mouse.down();
    await page.mouse.move(sheet.x + 250, sheet.y + 200, { steps: 6 }); await page.mouse.up();
    await page.waitForSelector('.win');
    await page.dblclick('.win');
    await page.waitForSelector('.pform h4:has-text("Window")');
    await page.click('.pform button:has-text("+ qr code")');
    await page.waitForTimeout(200);
    // auto-binding "qr1" was created with sample data — the QR renders from it
    await page.dblclick('.win');
    await page.click('.pform button:has-text("+ image")');
    await page.waitForTimeout(200);
  });

  await step('asset picker assigns assetId to the image element', async () => {
    // image element is now selected (props open after add)
    await page.waitForSelector('.pform h4:has-text("Element")');
    await page.click('.pform button:has-text("choose")');
    await page.waitForSelector('.dialog h3:has-text("Choose an image")');
    await page.click('.asset-card:has-text("logo-test.png")');
    await page.waitForSelector('.toast:has-text("assigned")');
    if (!(await page.locator('.sheet img.img-preview').count())) throw new Error('canvas image preview missing');
  });

  await step('live preview renders the QR code as SVG', async () => {
    await page.click('.tabs button:has-text("Preview")');
    await page.waitForTimeout(2500);
    const svg = await page.frameLocator('.preview-frame').locator('svg').count();
    if (svg < 1) throw new Error('no SVG in preview');
  });

  await step('submit for review -> REVIEW state and locked banner', async () => {
    await page.click('.toolbar button:has-text("Submit for review")');
    await page.waitForSelector('.chip.REVIEW');
    await page.waitForSelector('.banner:has-text("awaiting review")');
  });

  await step('approve & publish -> PUBLISHED', async () => {
    page.once('dialog', (d) => d.accept('Looks good'));
    await page.click('.toolbar button:has-text("Approve & publish")');
    await page.waitForSelector('.chip.PUBLISHED');
  });

  await step('history shows the audit trail', async () => {
    await page.click('.toolbar button:has-text("History")');
    await page.waitForSelector('.dialog h3:has-text("Version history")');
    const txt = await page.locator('.dialog').innerText();
    for (const a of ['SUBMITTED', 'APPROVED', 'PUBLISHED']) {
      if (!txt.includes(a)) throw new Error(`missing event ${a}`);
    }
    if (!txt.includes('Looks good')) throw new Error('comment missing');
    await page.click('.dialog-close');
  });

  await step('compare modal renders two versions side by side', async () => {
    await page.click('.toolbar button:has-text("New draft version")');
    await page.waitForSelector('.toast.success');
    await page.waitForTimeout(300);
    await page.click('.toolbar button:has-text("Compare")');
    await page.waitForSelector('.diff-dialog');
    await page.waitForTimeout(1500);
    if ((await page.locator('.diff-cols iframe').count()) !== 2) throw new Error('expected 2 iframes');
    await page.click('.dialog-close');
  });

  await page.screenshot({ path: '/tmp/ui-v4b.png' });
  await browser.close();
  log('SUITE B DONE');
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
