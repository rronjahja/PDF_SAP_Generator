'use strict';

/**
 * Step 9 — PDF generation with Playwright (Chromium)
 *
 * Pipeline: HTML → Playwright Chromium page → page.pdf() → Buffer / Base64
 *
 * Prerequisite: the Chromium browser binary must be installed once via
 *   npx playwright install chromium
 * Alternatively, point PDF_CHROMIUM_PATH at an existing Chromium/Chrome binary.
 */

const { AppError } = require('./errors');

let browserPromise = null;

/**
 * Resolves a Chromium executable in this order:
 *  1. PDF_CHROMIUM_PATH environment variable
 *  2. Playwright's own managed Chromium (after `npx playwright install chromium`)
 *  3. Optional fallback package `@sparticuz/chromium` (npm-hosted binary),
 *     useful in environments where Playwright's browser CDN is unreachable.
 * Returns undefined to let Playwright use its default lookup.
 */
async function resolveExecutablePath(pw) {
  if (process.env.PDF_CHROMIUM_PATH) return process.env.PDF_CHROMIUM_PATH;

  try {
    const p = pw.chromium.executablePath();
    if (p && require('fs').existsSync(p)) return undefined; // default works
  } catch {
    /* fall through */
  }

  try {
    // optional dependency — only used when the managed browser is missing
    const sparticuz = require('@sparticuz/chromium');
    const C = sparticuz.default || sparticuz;
    return await C.executablePath();
  } catch {
    return undefined; // let Playwright produce its descriptive error
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const pw = require('playwright');
      const executablePath = await resolveExecutablePath(pw);
      return pw.chromium.launch({
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
      });
    })().catch((err) => {
      browserPromise = null; // allow retry after a failed launch
      throw err;
    });
  }
  return browserPromise;
}

/**
 * Converts an HTML document into a PDF buffer.
 * @param {string} html complete HTML document
 * @param {{format?: string, margin?: {top,right,bottom,left}}} [options]
 *        Margins default to 0 because windows are absolutely positioned and
 *        already include the page margins of the template.
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html, options = {}) {
  let browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    throw new AppError(
      'PDF_RENDERING_FAILED',
      `Chromium could not be launched: ${err.message}. ` +
        `Run 'npx playwright install chromium' once, or set PDF_CHROMIUM_PATH to an existing Chromium/Chrome binary.`
    );
  }

  let page;
  try {
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const margin = options.margin || { top: 0, right: 0, bottom: 0, left: 0 };
    const buffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin
    });
    return buffer;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('PDF_RENDERING_FAILED', `PDF rendering failed: ${err.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/** Closes the shared browser instance (used on shutdown and in tests). */
async function closeBrowser() {
  if (browserPromise) {
    const p = browserPromise;
    browserPromise = null;
    try {
      const browser = await p;
      await browser.close();
    } catch {
      /* ignore */
    }
  }
}

/** True when a Chromium executable can be resolved (health checks). */
async function chromiumAvailable() {
  try {
    if (process.env.PDF_CHROMIUM_PATH) return require('fs').existsSync(process.env.PDF_CHROMIUM_PATH);
    const pw = require('playwright');
    const p = await resolveExecutablePath(pw);
    return !!p && require('fs').existsSync(p);
  } catch {
    return false;
  }
}

module.exports = { htmlToPdf, closeBrowser, chromiumAvailable };
