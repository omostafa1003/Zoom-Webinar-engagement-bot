const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function getWsEndpoint() {
  const arg = process.argv.find(a => a.startsWith('--ws='));
  if (arg) return arg.split('=')[1];
  try {
    const p = path.join(__dirname, 'browser-ws-endpoint.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch (e) {}
  return null;
}

const ws = getWsEndpoint();
if (!ws) {
  console.error('Usage: node raiseHand.js --ws=WS_ENDPOINT or ensure browser-ws-endpoint.txt exists');
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function attachDialogHandler(page) {
    page.on('dialog', async dialog => {
      const msg = (dialog.message() || '').toLowerCase();
      if (msg.includes('leave site') || msg.includes('changes you made may not be saved') || dialog.type() === 'beforeunload') {
        console.log('Dismissing leave-site dialog:', dialog.message());
        try {
          await dialog.dismiss();
        } catch (e) {
          console.warn('Failed to dismiss dialog:', e.message);
        }
      } else {
        try {
          await dialog.dismiss();
        } catch (e) {}
      }
    });
  }

  for (const pg of await browser.pages()) {
    attachDialogHandler(pg);
  }
  browser.on('targetcreated', async target => {
    try {
      if (target.type() === 'page') {
        const pg = await target.page();
        if (pg) attachDialogHandler(pg);
      }
    } catch (e) {}
  });

  // function executed inside page/frame to locate a raise-hand button
  function deepFinder() {
    function deepQuery(root) {
      const q = [root];
      while (q.length) {
        const node = q.shift();
        try {
          if (node.querySelector) {
            const byId = node.querySelector('#raisehand');
            if (byId) return { found: true, outer: byId.outerHTML ? byId.outerHTML.slice(0,400) : null };
            const btn = node.querySelector('button[aria-label*="Raise Hand" i], button[aria-label*="raise hand" i], div[feature-type="raisehand"] button, #raisehand button, button.footer-button-base__button');
            if (btn) return { found: true, outer: btn.outerHTML ? btn.outerHTML.slice(0,400) : null };
          }
        } catch (e) {}
        try { if (node.children) Array.from(node.children).forEach(c=>q.push(c)); } catch(e) {}
        try { if (node.shadowRoot) q.push(node.shadowRoot); } catch(e) {}
      }
      return { found: false };
    }
    return deepQuery(document);
  }

  // function executed inside page/frame to click the raise-hand button
  function deepClick() {
    function deepQuery(root) {
      const q = [root];
      while (q.length) {
        const node = q.shift();
        try {
          if (node.querySelector) {
            const byId = node.querySelector('#raisehand');
            if (byId) {
              const btn = byId.querySelector('button'); if (btn) { btn.click(); return true; }
            }
            const btn = node.querySelector('button[aria-label*="Raise Hand" i], button[aria-label*="raise hand" i], div[feature-type="raisehand"] button');
            if (btn) { btn.click(); return true; }
          }
        } catch (e) {}
        try { if (node.children) Array.from(node.children).forEach(c=>q.push(c)); } catch(e){}
        try { if (node.shadowRoot) q.push(node.shadowRoot); } catch(e){}
      }
      return false;
    }
    return deepQuery(document);
  }

  // read label text inside frame
  function deepReadLabel() {
    function deepRead(root) {
      const q = [root];
      while (q.length) {
        const node = q.shift();
        try {
          if (node.querySelector) {
            const byId = node.querySelector('#raisehand');
            const host = byId ? byId : node.querySelector('div[feature-type="raisehand"]');
            const btn = host ? (host.querySelector ? host.querySelector('button') : null) : node.querySelector('button[aria-label*="Raise Hand" i], button[aria-label*="raise hand" i]');
            const labelEl = btn ? (btn.querySelector ? btn.querySelector('.footer-button-base__button-label') : null) : null;
            if (labelEl) return labelEl.textContent.trim();
            if (btn && btn.getAttribute) return (btn.getAttribute('aria-label')||'').trim();
          }
        } catch(e) {}
        try { if (node.children) Array.from(node.children).forEach(c=>q.push(c)); } catch(e){}
        try { if (node.shadowRoot) q.push(node.shadowRoot); } catch(e){}
      }
      return null;
    }
    return deepRead(document);
  }

  // click a button by visible text inside frame
  function deepClickButtonWithText(texts) {
    function deepQuery(root) {
      const q = [root];
      while (q.length) {
        const node = q.shift();
        try {
          if (node.querySelector) {
            const sel = 'button, input[type=button], input[type=submit], a, [role="button"], div[role="button"], span[role="button"]';
            const buttons = Array.from(node.querySelectorAll(sel));
            for (const btn of buttons) {
              const text = (btn.textContent || '').trim().toLowerCase();
              const aria = (btn.getAttribute && (btn.getAttribute('aria-label') || btn.getAttribute('title') || '')) || '';
              const combined = (text + ' ' + aria).trim();
              if (texts.some(t => combined.includes(t))) {
                try { btn.click(); return true; } catch(e) { try { btn.dispatchEvent(new MouseEvent('click', {bubbles:true})); return true; } catch(e2) {} }
              }
            }
          }
        } catch (e) {}
        try { if (node.children) Array.from(node.children).forEach(c=>q.push(c)); } catch(e){}
        try { if (node.shadowRoot) q.push(node.shadowRoot); } catch(e){}
      }
      return false;
    }
    return deepQuery(document);
  }

  function deepClickPopupCancel() {
    function deepQuery(root) {
      const q = [root];
      while (q.length) {
        const node = q.shift();
        try {
          if (node.querySelector) {
            const buttons = Array.from(node.querySelectorAll('button'));
            for (const btn of buttons) {
              const text = btn.textContent ? btn.textContent.trim().toLowerCase() : '';
              if (text === 'cancel' || text === 'cancel ') {
                const maybePopup = btn.closest('div');
                if (maybePopup && maybePopup.textContent) {
                  const popupText = maybePopup.textContent.toLowerCase();
                  if (popupText.includes('leave site') || popupText.includes('changes you made may not be saved')) {
                    btn.click();
                    return true;
                  }
                } else {
                  btn.click();
                  return true;
                }
              }
            }
          }
        } catch (e) {}
        try { if (node.children) Array.from(node.children).forEach(c=>q.push(c)); } catch(e){}
        try { if (node.shadowRoot) q.push(node.shadowRoot); } catch(e){}
      }
      return false;
    }
    return deepQuery(document);
  }

  async function findRaiseHandButtonInPage(page) {
    const frames = page.frames();
    for (const f of frames) {
      try {
        const res = await f.evaluate(deepFinder);
        if (res && res.found) return { frame: f, info: res };
      } catch (e) {}
    }
    return null;
  }

  async function findRaiseHandAcrossPages(timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const pagesNow = await browser.pages();
      for (const p of pagesNow) {
        try {
          const res = await findRaiseHandButtonInPage(p);
          if (res) return { page: p, frame: res.frame, info: res.info };
        } catch (e) {}
      }
      await sleep(500);
    }
    return null;
  }

  // list open pages for debugging
  try {
    const pgs = await browser.pages();
    const list = await Promise.all(pgs.map(async p => ({ url: p.url(), title: await p.title().catch(()=>null) })));
    console.log('Open pages:', JSON.stringify(list, null, 2));
  } catch (e) {}

  try {
    const found = await findRaiseHandAcrossPages(20000);
    if (!found) {
      console.warn('Raise Hand button not found');
      // build a report for all pages/frames
      const pagesNow = await browser.pages();
      const report = {};
      for (const pg of pagesNow) {
        try {
          const frames = pg.frames();
          const frameReport = {};
          for (const f of frames) {
            try {
              const exists = await f.evaluate(() => !!document.querySelector('#raisehand')).catch(() => false);
              const snippet = exists ? await f.evaluate(() => { const el = document.querySelector('#raisehand'); return el ? (el.outerHTML || el.innerHTML).slice(0,400) : null; }).catch(() => null) : null;
              frameReport[f.url() || f.name() || '<frame>'] = { hasRaisehand: !!exists, snippet };
            } catch (e) {
              frameReport[f.url() || f.name() || '<frame>'] = 'error';
            }
          }
          report[pg.url() || pg.title() || '<page>'] = frameReport;
        } catch (e) {
          report[pg.url() || pg.title() || '<page>'] = 'error';
        }
      }
      console.warn('Frame raisehand report:', JSON.stringify(report, null, 2));
      process.exit(0);
    }

    const targetPage = found.page;
    const f = found.frame;
    await targetPage.bringToFront();
    console.log('Found raisehand candidate in page:', targetPage.url() || targetPage.title(), found.info.outer);

    // attempt click inside the frame
    try {
      const clicked = await f.evaluate(deepClick);
      if (clicked) console.log('Clicked Raise Hand');
      else console.warn('Found candidate but failed to click');
    } catch (e) { console.warn('Click attempt failed:', e.message); }

    // monitor label changes
    let prev = await f.evaluate(deepReadLabel).catch(() => null);
    console.log('Initial raise-hand label:', prev);
    setInterval(async () => {
      try {
        const label = await f.evaluate(deepReadLabel);
        if (label) {
          // detect transition from Lower -> Raise
          if (prev && prev.toLowerCase().includes('lower') && label.toLowerCase().includes('raise')) {
            console.log('Host lowered your hand (button label returned to Raise Hand)');
          }
          prev = label;
        }
      } catch (e) {}
    }, 1500);

    // Monitor for "Join as Panelist" accept button and click it when it appears
    const acceptCheck = setInterval(async () => {
      try {
        const pages = await browser.pages();
        for (const p of pages) {
          const frames = p.frames();
          for (const ff of frames) {
            try {
              const clicked = await ff.evaluate(deepClickButtonWithText, ['join as panelist']);
              if (clicked) {
                console.log('Clicked "Join as Panelist" accept button');
                clearInterval(acceptCheck);
                return;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }, 1000);

    // Monitor for "Continue without microphone and camera" and click it when it appears.
    // Keep this active because the popup may appear more than once.
    const continueCheck = setInterval(async () => {
      try {
        const pages = await browser.pages();
        for (const p of pages) {
          const frames = p.frames();
          for (const ff of frames) {
            try {
              const clicked = await ff.evaluate(() => {
                const clickNode = node => {
                  if (!node) return false;
                  try {
                    node.click();
                    return true;
                  } catch (e) {
                    try {
                      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                      return true;
                    } catch (e2) {
                      return false;
                    }
                  }
                };

                const clickBySelector = sel => {
                  try {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    if (clickNode(el)) return true;
                    const btn = el.querySelector('button, a, [role="button"], span[role="button"], input[type=button], input[type=submit]');
                    if (btn && clickNode(btn)) return true;
                  } catch (e) {}
                  return false;
                };

                const clickByText = text => {
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
                  while (walker.nextNode()) {
                    const node = walker.currentNode;
                    const txt = (node.textContent || '').trim().toLowerCase();
                    if (txt.includes(text)) {
                      if (clickNode(node)) return true;
                    }
                  }
                  return false;
                };

                if (clickBySelector('span.pepc-permission-dialog__footer-button')) return true;
                if (clickBySelector('.pepc-permission-dialog__footer [role="button"]')) return true;
                if (clickBySelector('.pepc-permission-dialog__footer')) return true;
                if (clickByText('continue without microphone and camera')) return true;
                if (clickByText('continue without microphone')) return true;
                if (clickByText('continue without camera')) return true;
                return false;
              });

              if (clicked) {
                console.log('Clicked continue-without-media popup');
                return;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }, 1000);

    // Monitor for the "Leave site" toaster and click the cancel button when it appears
    const leaveCancelCheck = setInterval(async () => {
      try {
        const pages = await browser.pages();
        for (const p of pages) {
          const frames = p.frames();
          for (const ff of frames) {
            try {
              const clicked = await ff.evaluate(deepClickPopupCancel);
              if (clicked) {
                console.log('Clicked "Cancel" on the leave-site popup');
                clearInterval(leaveCancelCheck);
                return;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }, 1000);

    console.log('Monitoring raise-hand label. Press Ctrl+C to exit.');
  } catch (e) {
    console.warn('Error while handling Raise Hand:', e.message);
  }

})();
