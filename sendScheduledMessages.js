const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// === Message schedule (offsets in seconds from script start) ===
// Edit these offsets (seconds) to control when messages are sent relative to
// when the script starts. Example: offsetSeconds: 10 -> send 10s after start.
const schedule = [
  { offsetSeconds: 5, message: "yeah" },
  { offsetSeconds: 35, message: "wow" },
  { offsetSeconds: 65, message: "that's a nice approach" },
  { offsetSeconds: 95, message: "interesting point" },
  { offsetSeconds: 125, message: "makes sense" }
];

function getMeetingUrl() {
  const arg = process.argv.find(a => a.startsWith('--url='));
  if (arg) return arg.split('=')[1];
  if (process.argv[2]) return process.argv[2];

  // Fallback: read saved link from meeting-link.txt in script directory
  try {
    const filePath = path.join(__dirname, 'meeting-link.txt');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content) return content;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

const meetingUrl = getMeetingUrl();
if (!meetingUrl) {
  console.error('Usage: node sendScheduledMessages.js --url=MEETING_URL');
  console.error('Or create a file named meeting-link.txt next to this script containing the join URL.');
  process.exit(1);
}

(async () => {
  const launchArgs = [
    '--start-maximized',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars'
  ];
  let browser;
  let page;
  let connectedToExisting = false;
  const wsFile = path.join(__dirname, 'browser-ws-endpoint.txt');
  if (fs.existsSync(wsFile)) {
    const ws = fs.readFileSync(wsFile, 'utf8').trim();
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: ws,
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        protocolTimeout: 120000
      });
      connectedToExisting = true;
      console.log('Connected to existing browser via websocket');
      const pages = await browser.pages();
      const meetingUrlLower = meetingUrl ? meetingUrl.toLowerCase() : '';
      const zoomPages = pages.filter(p => {
        const url = (p.url() || '').toLowerCase();
        return url.includes('zoom.us') || url.includes('zoom.com') || url.includes('zoom.us/wc') || url.includes('events.zoom.us') || (meetingUrlLower && url.includes(meetingUrlLower));
      });
      page = zoomPages.find(p => (p.url() || '').includes('events.zoom.us')) || zoomPages[zoomPages.length - 1] || pages[pages.length - 1] || null;
      if (page) {
        await page.bringToFront();
        console.log('Selected existing page:', page.url());
        try {
          await page.setViewport({ width: 1600, height: 900 });
        } catch (e) {
          // ignore viewport resize failures
        }
      }
      if (!page) {
        page = await browser.newPage();
        console.log('No existing Zoom page found; opened a new blank page.');
      }
    } catch (e) {
      console.warn('Failed to connect to existing browser:', e.message);
      browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: launchArgs, ignoreHTTPSErrors: true, slowMo: 20, protocolTimeout: 120000 });
      page = await browser.newPage();
    }
  } else {
    browser = await puppeteer.launch({ headless: false, defaultViewport: null, args: launchArgs, ignoreHTTPSErrors: true, slowMo: 20, protocolTimeout: 120000 });
    page = await browser.newPage();
  }
  const originalLandingPage = page;

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  page.on('requestfailed', req => console.warn('REQUEST FAILED:', req.url()));
  browser.on('disconnected', () => console.error('Browser disconnected unexpectedly'));

  // If we launched a new browser (not connected), navigate to meetingUrl.
  if (!connectedToExisting) {
    try {
      await page.goto(meetingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (err) {
      console.warn('Initial navigation failed:', err.message);
      try {
        const encoded = encodeURI(meetingUrl);
        console.log('Retrying with encoded URL...');
        await page.goto(encoded, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (err2) {
        console.error('Navigation retry failed:', err2.message);
        await browser.close();
        process.exit(1);
      }
    }
  } else {
    // connectedToExisting: try to find an existing zoom page; wait up to 20s for it
    try {
      const zoomPage = await (async () => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const pages = await browser.pages();
          const found = pages.find(p => (p.url() || '').includes('zoom.us'));
          if (found) return found;
          await new Promise(r => setTimeout(r, 500));
        }
        return null;
      })();
      if (zoomPage) {
        page = zoomPage;
        await page.bringToFront();
        console.log('Attached to existing Zoom page:', page.url());
      } else {
        console.warn('No existing Zoom page found in connected browser. Proceeding without navigating.');
        if (meetingUrl) {
          try {
            console.log('Opening meeting URL in existing browser to recover.');
            await page.goto(meetingUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('Recovered by navigating to meeting URL:', meetingUrl);
          } catch (navErr) {
            console.warn('Recovery navigation failed:', navErr.message);
          }
        }
      }
    } catch (e) {
      console.warn('Error while locating existing Zoom page:', e.message);
    }
  }

  // small sleep helper
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  // Give user a little time to log in if needed
  await sleep(3000);

  // If the page shows a "Join from your browser" link (bypass native Zoom app prompt), navigate to it
  try {
    const clicked = await page.evaluate(() => {
      const anchor = Array.from(document.querySelectorAll('a'))
        .find(a => a.textContent && a.textContent.trim().toLowerCase().includes('join from your browser'));
      if (anchor) {
        anchor.click();
        return true;
      }
      // also try buttons or links containing that phrase
      const other = Array.from(document.querySelectorAll('button,div'))
        .find(el => el.textContent && el.textContent.trim().toLowerCase().includes('join from your browser'));
      if (other) { other.click(); return true; }
      return false;
    });
    if (clicked) {
      console.log('Clicked "Join from your browser" element — waiting for web client.');
      // Wait for a new page/tab to open for the web client and switch to it
      try {
        const beforeTargets = browser.targets().map(t => t.url());
        const target = await browser.waitForTarget(t => {
          const u = t.url();
          if (!u) return false;
          if (beforeTargets.includes(u)) return false;
          return u.includes('zoom.us');
        }, { timeout: 15000 });
        if (target) {
          const newPage = await target.page();
          if (newPage) {
            page = newPage;
            await page.bringToFront();
            console.log('Switched to web client tab:', page.url());
            await sleep(2000);
            // pick active zoom page in case of redirects
            try {
              const pages = await browser.pages();
              const zoomPages = pages.filter(p => (p.url() || '').includes('zoom.us'));
              if (zoomPages.length) {
                page = zoomPages[zoomPages.length - 1];
                await page.bringToFront();
                console.log('Selected active zoom page:', page.url());
              }
            } catch (e) {
              console.warn('Could not reselect zoom page:', e.message);
            }
            try {
              if (originalLandingPage && !originalLandingPage.isClosed()) {
                await originalLandingPage.close();
                console.log('Closed original landing page.');
              }
            } catch (closeErr) {
              console.warn('Failed to close original landing page:', closeErr.message);
            }
          }
        }
      } catch (e) {
        console.warn('No new web client tab detected, continuing in current page.');
        await sleep(2500);
      }
    }
  } catch (e) {
    console.warn('Could not navigate to browser join link:', e.message);
  }

  // Try to dismiss the "Open Zoom Meetings" protocol prompt by sending Escape and clicking.
  try {
    // helper to check if page is closed
    const isPageClosed = (p) => (p && typeof p.isClosed === 'function') ? p.isClosed() : false;
    // If current page is closed, try to pick another zoom page
    if (isPageClosed(page)) {
      try {
        const pages = await browser.pages();
        const zoomPages = pages.filter(p => (p.url() || '').includes('zoom.us'));
        if (zoomPages.length) {
          page = zoomPages[zoomPages.length - 1];
          await page.bringToFront();
          console.log('Switching to available zoom page for dismiss:', page.url());
        }
      } catch (e) {
        console.warn('No available page to dismiss protocol prompt:', e.message);
      }
    }

    if (!isPageClosed(page)) {
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        await sleep(200);
      }
      // Click near top-left to close any overlay
      const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const clickX = Math.min(50, Math.floor(dims.w * 0.05));
      const clickY = Math.min(50, Math.floor(dims.h * 0.05));
      await page.mouse.click(clickX, clickY);
      await sleep(500);
    }
  } catch (e) {
    console.warn('Could not dismiss protocol prompt via keyboard/mouse:', e.message);
  }

  // Try to open the chat panel by clicking the chat button
  try {
    const chatButtonSelectors = [
      'button[aria-label*="open the chat panel"]',
      'button[aria-label="open the chat panel"]',
      'button.footer-button-base__button',
      'button.footer-button__button',
      'button[aria-label*="chat"]',
      'button[title*="Chat"]'
    ];
    // helper: search frames for a selector and click
    async function clickInFrames(selectors, timeout = 10000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const frames = page.frames();
        for (const f of frames) {
          for (const s of selectors) {
            try {
              const el = await f.$(s);
              if (el) {
                try {
                  await f.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.click(); }, s);
                } catch (e) {
                  await el.click();
                }
                return s;
              }
            } catch (e) {
              // ignore
            }
          }
        }
        await sleep(500);
      }
      return null;
    }

    let clickedSel = await clickInFrames(chatButtonSelectors, 15000);
    if (!clickedSel) {
      // Try the More menu path in case chat is hidden behind More.
      try {
        const moreClicked = await page.evaluate(() => {
          const norm = (s) => (s || '').toString().trim().toLowerCase();
          const more = Array.from(document.querySelectorAll('button, [role="button"], div[role="button"], span[role="button"]'))
            .find(el => norm(el.getAttribute('aria-label')).includes('more') || norm(el.textContent).includes('more'));
          if (more) {
            more.click();
            return true;
          }
          return false;
        });
        if (moreClicked) {
          console.log('Clicked More menu to reveal chat');
          await sleep(1000);
          clickedSel = await clickInFrames(chatButtonSelectors, 10000);
        }
      } catch (e) {
        console.warn('More menu click failed:', e.message);
      }
    }
    if (clickedSel) {
      console.log('Clicked chat button selector (frames):', clickedSel);
      await sleep(500);
    } else {
      // Fallback: try clicking any button or element whose text contains 'chat' in the main page
      try {
        const fallbackClicked = await page.evaluate(() => {
          const norm = (s) => (s || '').toString().trim().toLowerCase();
          const all = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], li'));
          for (const el of all) {
            const text = norm(el.textContent);
            if (text.includes('chat') || text.includes('open chat') || text.includes('chat panel')) {
              el.click();
              return true;
            }
            const aria = norm(el.getAttribute && el.getAttribute('aria-label'));
            if (aria.includes('chat') || aria.includes('open chat') || aria.includes('chat panel')) {
              el.click();
              return true;
            }
          }
          return false;
        });
        if (fallbackClicked) {
          console.log('Clicked chat button via fallback DOM scan');
          await sleep(500);
        } else {
          // dump frame info for debugging
          const framesInfo = page.frames().map(f => ({ url: f.url(), name: f.name() }));
          console.warn('Could not find chat button to open panel. Frames:', JSON.stringify(framesInfo, null, 2));
          // also dump top-level footer buttons
          const footerButtons = await page.evaluate(() => Array.from(document.querySelectorAll('button.footer-button-base__button, button.footer-button__button')).map(b => ({ text: b.textContent && b.textContent.trim(), aria: b.getAttribute('aria-label') })));
          console.warn('Footer buttons:', JSON.stringify(footerButtons, null, 2));
        }
      } catch (e) {
        console.warn('Fallback chat click failed:', e.message);
      }
    }
  } catch (e) {
    console.warn('Could not auto-open chat:', e.message);
  }

  // Try set recipient to Everyone
  try {
    await sleep(1000);
    await page.evaluate(() => {
      const receiverBtn = document.querySelector('button.chat-receiver-list__receiver');
      if (receiverBtn && receiverBtn.textContent.trim() !== 'Everyone') {
        receiverBtn.click();
        setTimeout(() => {
          const everyoneOption = Array.from(document.querySelectorAll('button,div'))
            .find(el => el.textContent && el.textContent.trim() === 'Everyone');
          if (everyoneOption) everyoneOption.click();
        }, 500);
      }
    });
  } catch (e) {
    console.warn('Could not set recipient:', e.message);
  }

  async function sendMessage(msg) {
    const editorSelectors = [
      'div.tiptap.ProseMirror',
      'div[contenteditable="true"]',
      'textarea.chat-box__chat-textarea',
      'textarea',
      'input[type="text"]'
    ];
    try {
      // Wait for any of the editor selectors to appear across all frames by polling
      async function waitForAnySelectorInFrames(selectors, timeout = 10000, interval = 500) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          const frames = page.frames();
          for (const f of frames) {
            for (const s of selectors) {
              try {
                const el = await f.$(s);
                if (el) return { frame: f, selector: s, element: el };
              } catch (e) {
                // ignore
              }
            }
          }
          await sleep(interval);
        }
        return null;
      }

      const found = await waitForAnySelectorInFrames(editorSelectors, 10000, 500);
      if (!found) {
        // Dump debug info across frames: counts and short outerHTML
        const debug = {};
        const frames = page.frames();
        for (const f of frames) {
          try {
            const info = await f.evaluate((sels) => {
              const out = {};
              for (const s of sels) {
                try {
                  const list = Array.from(document.querySelectorAll(s));
                  out[s] = list.slice(0,3).map(el => ({ text: el.textContent && el.textContent.trim().slice(0,120), outer: el.outerHTML && el.outerHTML.slice(0,400) }));
                } catch (e) { out[s] = 'error'; }
              }
              return out;
            }, editorSelectors);
            debug[f.url() || f.name() || '<frame>'] = info;
          } catch (e) {
            debug[f.url() || f.name() || '<frame>'] = 'error evaluating frame';
          }
        }
        console.error('No editor found. Debug info across frames:', JSON.stringify(debug, null, 2));
        throw new Error('No chat editor found');
      }

      const { frame: foundFrame, selector: foundSel, element: elHandle } = found;
      console.log('Found editor selector in frame:', foundFrame.url() || foundFrame.name(), foundSel);
      // Focus element handle
      try {
        await elHandle.focus();
      } catch (e) {
        try { await foundFrame.evaluate(sel => { const el = document.querySelector(sel); if (el) el.focus(); }, foundSel); } catch (e2) {}
      }

      // Clear existing text (Ctrl/Cmd + A, Backspace) using page keyboard after focusing
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.down(modifier);
      await page.keyboard.press('KeyA');
      await page.keyboard.up(modifier);
      await page.keyboard.press('Backspace');

      // Type the message with realistic delays using the element handle
      try {
        await elHandle.type(msg, { delay: 80 });
      } catch (e) {
        // fallback to keyboard
        await page.keyboard.type(msg, { delay: 80 });
      }

      // Small pause then look for send button across frames
      await sleep(200);
      const sendSelectors = [
        'button.chat-rtf-box__send',
        'button[aria-label="Send"]',
        'button[data-testid="send"]',
        'button[type="submit"]'
      ];
      async function waitForAnySelectorInFramesSimple(selectors, timeout = 3000, interval = 300) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          const frames = page.frames();
          for (const f of frames) {
            for (const s of selectors) {
              try {
                const el = await f.$(s);
                if (el) return { frame: f, selector: s, element: el };
              } catch (e) {}
            }
          }
          await sleep(interval);
        }
        return null;
      }

      const sendFound = await waitForAnySelectorInFramesSimple(sendSelectors, 3000, 300);
      if (sendFound) {
        try {
          const { element: sendEl, selector: sendSel, frame: sendFrame } = sendFound;
          const disabled = await sendFrame.evaluate(sel => { const b = document.querySelector(sel); return b && b.disabled; }, sendSel).catch(() => false);
          if (!disabled) {
            await sendEl.click();
            console.log('Sent via selector', sendSel, msg);
          } else {
            try { await elHandle.press('Enter'); console.log('Send selector disabled, pressed Enter via element'); } catch (e) { await page.keyboard.press('Enter'); console.log('Send selector disabled, pressed Enter via page'); }
          }
        } catch (e) {
          try { await elHandle.press('Enter'); console.log('Send click failed, pressed Enter via element'); } catch (e2) { await page.keyboard.press('Enter'); console.log('Send click failed, pressed Enter via page'); }
        }
      } else {
        try { await elHandle.press('Enter'); console.log('No send selector found, pressed Enter via element'); } catch (e) { await page.keyboard.press('Enter'); console.log('No send selector found, pressed Enter via page'); }
      }
    } catch (err) {
      console.error('Failed to send message:', err.message);
    }
  }

  // Compute scheduling using offsets (seconds)
  const now = Date.now();
  const sendTimes = schedule.map(item => ({
    sendAt: now + (item.offsetSeconds || 0) * 1000,
    msg: item.message,
    offsetMs: (item.offsetSeconds || 0) * 1000
  }));
  const futureOffsets = sendTimes.map(s => s.offsetMs).filter(v => v > 0);
  const maxDelay = futureOffsets.length ? Math.max(...futureOffsets) : 0;

  // Send or schedule
  for (const item of sendTimes) {
    const delay = item.sendAt - Date.now();
    if (delay <= 0) {
      await sendMessage(item.msg);
    } else {
      setTimeout(() => sendMessage(item.msg).catch(console.error), delay);
      console.log('Scheduled in', Math.round(delay / 1000), 's:', item.msg);
    }
  }

  // Keep process alive until last scheduled message is sent
  const waitMs = maxDelay > 0 ? maxDelay + 8000 : 5000;
  console.log('Will keep browser open for', Math.round(waitMs / 1000), 'seconds to finish scheduled messages.');
  await new Promise(resolve => setTimeout(resolve, waitMs));
  console.log('Done sending scheduled messages.');
  // Optionally close browser
  // await browser.close();
})();
