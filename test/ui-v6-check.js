/* v6 checks: destinations settings UI, template settings dialog, documents browser. */
const { chromium } = require('playwright');
const fs = require('fs');
const log = (l) => { console.log(l); fs.appendFileSync('/tmp/ui-v6.log', l + '\n'); };
const step = async (name, fn) => {
  try { await fn(); log('PASS: ' + name); } catch (e) { log('FAIL: ' + name + ' — ' + e.message.split('\n')[0]); process.exitCode = 1; }
};

(async () => {
  const C = require('@sparticuz/chromium').default;
  const browser = await chromium.launch({ headless: true, executablePath: await C.executablePath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(9000);
  await page.goto('http://localhost:4004/designer/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tpl-card'); // app hydrated and templates loaded

  await step('destinations page: create a LOCAL_DIR destination via the form', async () => {
    await page.click('.toolbar button:has-text("Destinations")');
    await page.waitForSelector('.settings-page .brand:has-text("Delivery destinations")');
    await page.click('button:has-text("New destination")');
    await page.fill('.dest-form input[placeholder="archive"]', 'ui-archive');
    await page.fill('.dest-form input[placeholder="/data/invoices"]', '/tmp/pdf-ui-out');
    await page.click('.dest-form button:has-text("Create destination")');
    await page.waitForSelector('.dest-row:has-text("ui-archive")');
  });

  await step('test button reports the directory as writable', async () => {
    await page.click('.dest-row:has-text("ui-archive") button:has-text("Test")');
    await page.waitForSelector('.toast.success:has-text("Test success")');
  });

  await step('template settings: pattern + default destination', async () => {
    await page.click('.settings-page .toolbar button:has-text("←")');
    await page.waitForSelector('.tpl-card');
    await page.click('.tpl-card:has-text("invoice-standard") button:has-text("Settings")');
    await page.waitForSelector('.dialog h3:has-text("Template settings")');
    await page.fill('.dialog input[placeholder^="invoice-"]', 'inv-{invoice.number}-{date}.pdf');
    await page.check('.dest-check:has-text("ui-archive") input');
    await page.click('.dialog button:has-text("Save settings")');
    await page.waitForSelector('.toast.success:has-text("Settings")');
  });

  await step('generate via API uses pattern and delivers', async () => {
    const data = JSON.parse(fs.readFileSync(__dirname + '/../srv/samples/invoice-data.json', 'utf8'));
    const r = await fetch('http://localhost:4004/api/v1/templates/invoice-standard/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'latest', data })
    }).then((x) => x.json());
    if (r.fileName !== `inv-9000001234-${new Date().toISOString().slice(0, 10)}.pdf`) throw new Error('fileName: ' + r.fileName);
    if (!r.deliveries || r.deliveries[0].status !== 'SUCCESS') throw new Error('delivery: ' + JSON.stringify(r.deliveries));
    if (!fs.existsSync('/tmp/pdf-ui-out/' + r.fileName)) throw new Error('file missing on disk');
  });

  await step('documents browser lists the document with delivery chip', async () => {
    await page.click('.toolbar button:has-text("Documents")');
    await page.waitForSelector('.doc-row');
    const row = page.locator('.doc-row').first();
    if (!(await row.locator('a[download]').count())) throw new Error('download link missing');
    if (!(await row.locator('.chip:has-text("ui-archive")').count())) throw new Error('delivery chip missing');
  });

  await step('download link returns a PDF', async () => {
    const href = await page.locator('.doc-row a[download]').first().getAttribute('href');
    const res = await fetch('http://localhost:4004' + href);
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status !== 200 || !buf.slice(0, 4).equals(Buffer.from('%PDF'))) throw new Error(`status ${res.status}, head ${buf.slice(0, 4)}`);
  });

  await page.screenshot({ path: '/tmp/ui-v6.png' });
  await browser.close();
  log('SUITE DONE');
})().catch((e) => { log('FATAL: ' + e.message); process.exit(1); });
