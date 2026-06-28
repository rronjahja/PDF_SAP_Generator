/* v2 feature test: auto-bindings + sample-data sync + rename sync + dblclick. */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-v2.log', l + '\n'); };
const step = async (name, fn) => {
  try { await fn(); log('PASS: ' + name); } catch (e) { log('FAIL: ' + name + ' — ' + e.message); process.exitCode = 1; }
};

(async () => {
  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });

  await step('create a certificate template', async () => {
    await page.fill('input[placeholder^="New template name"]', 'certificate-test');
    await page.selectOption('.new-form select', 'CERTIFICATE');
    await page.click('text=Create template');
    await page.waitForSelector('.sheet');
  });

  await step('drop a HEADER window onto the sheet', async () => {
    const item = await page.locator('.palette-item', { hasText: 'Header' }).first().boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10);
    await page.mouse.down();
    await page.mouse.move(sheet.x + 300, sheet.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('.win');
  });

  await step('drop a TEXT element into the header -> auto-binding toast', async () => {
    const item = await page.locator('.palette-item', { hasText: /^Text$/ }).boundingBox();
    const win = await page.locator('.win').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10);
    await page.mouse.down();
    await page.mouse.move(win.x + 80, win.y + 25, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('.toast:has-text("text1")');
  });

  await step('sample data gained "text1" entry automatically', async () => {
    await page.click('.tabs button:has-text("Data")');
    const json = await page.locator('.data-panel textarea').inputValue();
    const data = JSON.parse(json);
    if (data.text1 === undefined) throw new Error('text1 missing in JSON: ' + json);
  });

  await step('element visible on canvas (no disappearing)', async () => {
    if ((await page.locator('.el').count()) < 1) throw new Error('element not rendered');
  });

  await step('rename binding text1 -> recipient.name moves the JSON entry', async () => {
    await page.dblclick('.el');                       // dblclick opens Properties on the element
    await page.waitForSelector('.pform h4:has-text("Element")');
    const bindingInput = page.locator('.pform input.mono').first();
    await bindingInput.fill('recipient.name');
    await page.click('.tabs button:has-text("Data")');
    const data = JSON.parse(await page.locator('.data-panel textarea').inputValue());
    if (data.text1 !== undefined) throw new Error('old key text1 still present');
    if (!data.recipient || data.recipient.name === undefined) throw new Error('recipient.name missing');
  });

  await step('drop a TABLE -> rows + columns appear in JSON', async () => {
    const item = await page.locator('.palette-item', { hasText: /^Table$/ }).boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10);
    await page.mouse.down();
    await page.mouse.move(sheet.x + 300, sheet.y + 320, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await page.click('.tabs button:has-text("Data")');
    const data = JSON.parse(await page.locator('.data-panel textarea').inputValue());
    if (!Array.isArray(data.table1)) throw new Error('table1 array missing');
    if (data.table1[0].col1 === undefined) throw new Error('col1 missing in row');
  });

  await step('deleting the element removes its JSON entry', async () => {
    await page.dblclick('.el');
    await page.click('.pform button:has-text("Delete element")');
    await page.click('.tabs button:has-text("Data")');
    const data = JSON.parse(await page.locator('.data-panel textarea').inputValue());
    if (data.recipient !== undefined) throw new Error('recipient entry not pruned');
  });

  await step('save draft persists', async () => {
    await page.click('.toolbar button:has-text("Save draft")');
    await page.waitForSelector('.toast.success');
  });

  await page.screenshot({ path: '/tmp/ui-v2.png' });
  await browser.close();
  log('SUITE DONE');
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
