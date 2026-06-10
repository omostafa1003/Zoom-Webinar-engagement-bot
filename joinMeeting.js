const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function getMeetingUrl() {
  const arg = process.argv.find(a => a.startsWith('--url='));
  if (arg) return arg.split('=')[1];
  // only treat a bare positional arg as the URL if it does not look like a flag
  if (process.argv[2] && !process.argv[2].startsWith('-')) return process.argv[2];
  try {
    const p = path.join(__dirname, 'meeting-link.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch (e) {}
  return null;
}

const meetingUrl = getMeetingUrl();
if (!meetingUrl) {
  console.error('Usage: node joinMeeting.js --url=MEETING_URL or create meeting-link.txt');
  process.exit(1);
}



(async () => {
  const launchArgs = ['--start-maximized', '--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox'];
  const browser = await puppeteer.launch({ headless: false, args: launchArgs, defaultViewport: null });
  const ws = browser.wsEndpoint();
  fs.writeFileSync(path.join(__dirname, 'browser-ws-endpoint.txt'), ws, 'utf8');
  console.log('Browser websocket endpoint written to browser-ws-endpoint.txt');

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.goto(meetingUrl, { waitUntil: 'networkidle2' });
  // track which page becomes the active web client tab
  let webClientPage = page;

  // small helper
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Click "Join from your browser" if present (opens new tab)
  try {
    let clicked = false;
    const deadline = Date.now() + 10000;
    while (!clicked && Date.now() < deadline) {
      clicked = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('a')).find(x => x.textContent && x.textContent.toLowerCase().includes('join from your browser'));
        if (a) { a.click(); return true; }
        const btn = Array.from(document.querySelectorAll('button,div')).find(x => x.textContent && x.textContent.toLowerCase().includes('join from your browser'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (!clicked) await sleep(500);
    }
    if (clicked) console.log('Clicked "Join from your browser" element.');
  } catch (e) { console.warn('Error clicking join from browser:', e.message); }

  // Wait for web client tab and switch
  try {
    const before = browser.targets().map(t => t.url());
    const target = await browser.waitForTarget(t => {
      const u = t.url();
      return u && !before.includes(u) && u.includes('zoom.us');
    }, { timeout: 15000 });
    if (target) {
      const p = await target.page();
      if (p) {
        webClientPage = p;
        await p.bringToFront();
        console.log('Switched to web client tab:', p.url());
      }
    }

    // Note: closing other pages is done after target-detection so it
    // runs regardless of whether a new web-client tab was detected.
  } catch (e) {
    console.warn('No web client tab detected (may be same tab).');
  }

  // Close all other non-webclient pages to avoid confusion
  if (webClientPage) {
    try {
      const allPages = await browser.pages();
      for (const pg of allPages) {
        if (pg !== webClientPage) {
          try { await pg.close(); console.log('Closed page:', pg.url() || '<blank>'); } catch (e) {}
        }
      }
    } catch (e) { console.warn('Failed to close other pages:', e.message); }
  }

  // Raise-hand handling removed from join script.
  // Use raiseHand.js to connect to the running browser and perform raise-hand actions separately.

  console.log('Join complete. Browser will remain open. Keep this process running while messaging.');
  console.log('Press Ctrl+C to exit and close the browser when finished.');
  // leave process running so browser stays open and wsEndpoint remains valid
  await new Promise(() => {});
})();
