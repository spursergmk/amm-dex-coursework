// Resilient browser launcher: prefer the Playwright-bundled Chromium, fall back to a
// locally installed Edge/Chrome so the scripts still run when the Chromium download
// is unavailable (offline machines, restricted networks).
import {chromium} from '@playwright/test';
import fs from 'node:fs';

function bundledChromium() {
  try {
    const exe = chromium.executablePath();
    return exe && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

export async function launchBrowser(options = {}) {
  const exe = bundledChromium();
  if (exe) return {browser: await chromium.launch({...options, executablePath: exe}), channel: 'bundled-chromium'};
  for (const channel of ['msedge', 'chrome']) {
    try {
      return {browser: await chromium.launch({...options, channel}), channel};
    } catch {
      /* try the next installed browser */
    }
  }
  throw new Error(
    'no browser available: run `npx playwright install chromium`, or install Microsoft Edge / Google Chrome',
  );
}
