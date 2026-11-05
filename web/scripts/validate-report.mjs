// Renders each report sheet to evidence/report-render/ and records what every page actually
// contains, so the delivered PDF can be checked without opening it by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser} from '../tests/launch.mjs';

const html = path.resolve('../docs/实验报告.html');
const outDir = path.resolve('../evidence/report-render');
await fs.mkdir(outDir, {recursive: true});
for (const old of await fs.readdir(outDir)) {
  if (/^page-\d+\.png$/.test(old)) await fs.rm(path.join(outDir, old));
}

const {browser} = await launchBrowser({headless: true});
try {
  const page = await browser.newPage({viewport: {width: 900, height: 1200}, deviceScaleFactor: 2});
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(() => document.fonts.ready);
  const sheets = await page.locator('.sheet').all();
  const checks = [];
  for (let i = 0; i < sheets.length; i++) {
    const stats = await sheets[i].evaluate(el => ({
      textCharacters: el.textContent.replace(/\s+/g, '').length,
      images: el.querySelectorAll('img').length,
      overflow: el.scrollHeight > el.clientHeight + 1,
      tableCount: el.querySelectorAll('table').length,
    }));
    await sheets[i].screenshot({path: path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`)});
    checks.push({page: i + 1, ...stats});
  }
  const overflow = checks.filter(c => c.overflow);
  const result = {pages: checks.length, overflowPages: overflow.length, checks};
  await fs.writeFile('../evidence/report-validation.json', JSON.stringify(result, null, 2));
  if (overflow.length) throw new Error(`report pages overflow: ${JSON.stringify(overflow)}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
