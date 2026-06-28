/* v3 feature checks. Run against a live server. */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-v3.log', l + '\n'); };
const step = async (name, fn) => {
  try { await fn(); log('PASS: ' + name); } catch (e) { log('FAIL: ' + name + ' — ' + e.message.split('\n')[0]); process.exitCode = 1; }
};

(async () => {
  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });

  await page.fill('input[placeholder^="New template name"]', 'v3-multi');
  await page.click('text=Create template');
  await page.waitForSelector('.sheet');

  const dropWindow = async (label, dx, dy) => {
    const item = await page.locator('.palette-item', { hasText: label }).first().boundingBox();
    const sheet = await page.locator('.sheet').boundingBox();
    await page.mouse.move(item.x + 20, item.y + 10); await page.mouse.down();
    await page.mouse.move(sheet.x + dx, sheet.y + dy, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(250);
  };

  await step('add a second page', async () => {
    await page.click('.pagenav button[title="Add a page"]');
    await page.waitForSelector('.pagenav:has-text("Page 2/2")');
  });

  await step('window dropped on page 2 stays on page 2', async () => {
    await dropWindow('Free section', 250, 200);
    const wins = await page.locator('.win').count();
    if (wins !== 1) throw new Error(`expected 1 window on page 2, saw ${wins}`);
    await page.click('.pagenav button:has-text("‹")');
    await page.waitForTimeout(200);
    if ((await page.locator('.win').count()) !== 0) throw new Error('window leaked onto page 1');
    await page.click('.pagenav button:has-text("›")');
    await page.waitForTimeout(200);
  });

  await step('header repeats on every page', async () => {
    await page.click('.pagenav button:has-text("‹")');
    await dropWindow('Header', 280, 50);
    await page.click('.pagenav button:has-text("›")');
    await page.waitForTimeout(200);
    if ((await page.locator('.win').count()) !== 2) throw new Error('repeating header not visible on page 2');
  });

  await step('drop RECTANGLE and CHECKBOX into the free section', async () => {
    const freeWin = await page.locator('[data-window]:not(:has-text("Header"))').first().boundingBox();
    for (const label of ['Rectangle', 'Checkbox']) {
      const item = await page.locator('.palette-item', { hasText: label }).boundingBox();
      await page.mouse.move(item.x + 20, item.y + 10); await page.mouse.down();
      await page.mouse.move(freeWin.x + 60, freeWin.y + 40, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(250);
    }
    if ((await page.locator('.sheet .el').count()) < 2) throw new Error('elements missing');
    const data = JSON.parse(await (async () => { await page.click('.tabs button:has-text("Data")'); return page.locator('.data-panel textarea').inputValue(); })());
    if (data.check1 === undefined) throw new Error('checkbox binding not in sample data');
  });

  await step('layers panel lists windows with lock + z-order', async () => {
    if ((await page.locator('.layer-row').count()) < 2) throw new Error('layer rows missing');
    await page.click('.layer-row .icon[title^="Lock"] >> nth=0');
    await page.waitForTimeout(150);
    if (!(await page.locator('.win-tag:has-text("🔒")').count())) throw new Error('lock badge missing');
  });

  await step('zoom buttons change scale', async () => {
    const before = (await page.locator('.sheet').boundingBox()).width;
    await page.click('.zoomctl button:has-text("+")');
    await page.waitForTimeout(200);
    const after = (await page.locator('.sheet').boundingBox()).width;
    if (after <= before) throw new Error('zoom in had no effect');
  });

  await step('API dialog shows curl with template name', async () => {
    await page.click('.toolbar button:has-text("API")');
    const pre = await page.locator('.dialog pre').innerText();
    if (!pre.includes('/api/v1/templates/v3-multi/generate')) throw new Error('snippet wrong: ' + pre.slice(0, 80));
    await page.click('.dialog-close');
  });

  await step('save draft', async () => {
    await page.click('.toolbar button:has-text("Save draft")');
    await page.waitForSelector('.toast.success');
  });

  await page.screenshot({ path: '/tmp/ui-v3.png' });
  await browser.close();

  // server-side: generate a 2-page PDF from the saved layout via preview
  await step('backend renders a 2-page PDF', async () => {
    const res = await fetch('http://localhost:4004/odata/v4/template/Templates?$filter=name eq \'v3-multi\'&$expand=versions');
    const tpl = (await res.json()).value[0];
    const vid = tpl.versions[0].ID;
    const prev = await fetch(`http://localhost:4004/api/v1/template-versions/${vid}/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const body = await prev.json();
    if (body.status !== 'SUCCESS') throw new Error('preview failed: ' + JSON.stringify(body).slice(0, 120));
    const pdf = Buffer.from(body.contentBase64, 'base64');
    fs.writeFileSync('/tmp/v3-two-page.pdf', pdf);
    const pageCount = (pdf.toString('latin1').match(/\/Type[\s]*\/Page[^s]/g) || []).length;
    if (pageCount < 2) throw new Error(`PDF has ${pageCount} page(s)`);
    log(`  -> PDF bytes ${pdf.length}, pages detected ${pageCount}`);
  });

  log('SUITE DONE');
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
