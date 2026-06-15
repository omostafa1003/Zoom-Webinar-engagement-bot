const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function timeOffsetToSeconds(timeStr) {
  const trimmed = (timeStr || '').toString().trim();
  const parts = trimmed.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(trimmed, 10) || 0;
}

function parseJSONMessages() {
  const filePath = path.join(__dirname, 'Test_JSONChat.json');
  if (!fs.existsSync(filePath)) return [];
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    console.error('Invalid JSON in Test_JSONChat.json:', e.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.map(item => {
    const timestamp = item.timestamp || item.timeoffset || item.offset || '';
    const sender = (item.sender || item['sender name'] || item['senderName'] || '').toString().trim();
    const message = (item.message || item.msg || item.text || '').toString().trim();
    return {
      timeoffset: timestamp,
      sender,
      message,
      offsetSeconds: timeOffsetToSeconds(timestamp)
    };
  }).sort((a, b) => a.offsetSeconds - b.offsetSeconds);
}

function parseCSV() {
  const filePath = path.join(__dirname, 'messagelist.csv');
  if (!fs.existsSync(filePath)) return [];
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const records = lines.slice(1).map(line => {
    const cells = line.split(',');
    const rec = {};
    headers.forEach((h,i) => rec[h] = (cells[i]||'').trim());
    return rec;
  });
  return records.sort((a,b)=> timeOffsetToSeconds(a.timeoffset||a.offset||'0') - timeOffsetToSeconds(b.timeoffset||b.offset||'0'));
}

async function getWebSdkFrame(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frames = page.frames();
    const frame = frames.find(f => f.name() === 'websdk' || f.url().includes('/websdk') || f.url().includes('/e/sessionView/'));
    if (frame) return frame;
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function clickButtonByAria(frame, ariaFragment, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const clicked = await frame.evaluate(fragment => {
        const target = Array.from(document.querySelectorAll('button')).find(el => {
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const text = (el.textContent || '').trim().toLowerCase();
          return aria.includes(fragment) || text.includes(fragment);
        });
        if (!target) return false;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.click();
        return true;
      }, ariaFragment.toLowerCase());
      if (clicked) return true;
    } catch (e) {
      // ignore frame errors
    }
    await sleep(200);
  }
  return false;
}

async function isPanelOpen(frame, ariaFragment) {
  try {
    return await frame.evaluate(fragment => {
      return !!Array.from(document.querySelectorAll('button')).find(el => {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        return aria.includes(fragment);
      });
    }, ariaFragment.toLowerCase());
  } catch (e) {
    return false;
  }
}

async function openChatPanel(frame) {
  return clickButtonByAria(frame, 'open the chat panel', 10000);
}

async function openParticipantsPanel(frame) {
  return clickButtonByAria(frame, 'open the participants list pane', 10000);
}

async function ensureParticipantPanelOpen(page) {
  const frame = await getWebSdkFrame(page, 15000);
  if (!frame) return false;

  const participantsOpen = await isPanelOpen(frame, 'close the participants list pane');
  if (participantsOpen) return true;

  const opened = await openParticipantsPanel(frame);
  if (!opened) return false;
  await sleep(500);
  return await isPanelOpen(frame, 'close the participants list pane');
}

async function ensureChatPanelOpen(page) {
  const frame = await getWebSdkFrame(page, 15000);
  if (!frame) return false;

  const chatOpen = await isPanelOpen(frame, 'close the chat panel');
  if (chatOpen) return true;

  const opened = await openChatPanel(frame);
  if (!opened) return false;
  await sleep(500);
  return await isPanelOpen(frame, 'close the chat panel');
}

async function renameCurrentUser(page, name, timeout = 30000) {
  const frame = await getWebSdkFrame(page, timeout);
  if (!frame) {
    console.warn('renameCurrentUser: websdk frame not found');
    return false;
  }
  console.log('renameCurrentUser frame:', frame.name(), frame.url());

  const result = await frame.evaluate(async (name, timeout) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const visible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const clickElement = el => {
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.click();
      return true;
    };

    const waitFor = async (fn, ms = timeout) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const value = await fn();
        if (value) return value;
        await sleep(200);
      }
      return null;
    };

    const openParticipantsPanel = async () => {
      const panelSelector = '#wc-container-left.show-participants, .show-participants, #participants-ul, .participants-ul';
      let panel = document.querySelector(panelSelector);
      if (panel && visible(panel)) return panel;

      const selectors = [
        '#participant > button',
        'button[aria-label*="participants list pane"]',
        'button[aria-label*="Participants"]',
        'button[title*="Participants"]',
        'button[aria-label*="open the participants list pane"]',
        'button[aria-label*="particpants"]'
      ];
      let button = selectors.map(s => document.querySelector(s)).find(el => el && visible(el));
      if (!button) {
        const allButtons = Array.from(document.querySelectorAll('button')).filter(visible);
        button = allButtons.find(el => /participants|participant|participants list pane/i.test(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`));
      }
      if (!button) return null;
      clickElement(button);
      await sleep(500);
      panel = await waitFor(() => {
        const found = document.querySelector(panelSelector);
        return found && visible(found) ? found : null;
      }, 5000);
      return panel;
    };

    const participantsPanel = await openParticipantsPanel();
    if (!participantsPanel) {
      return { ok: false, reason: 'Participants panel did not open' };
    }

    const meItem = Array.from(document.querySelectorAll('.participants-li, .item-pos.participants-li, [id^="participants-list-"]'))
      .find(el => (el.getAttribute('aria-label') || '').includes('(Me)'))
      || Array.from(document.querySelectorAll('.participants-li, .item-pos.participants-li, [id^="participants-list-"]')).find(el => (el.textContent || '').includes('(Me)'));
    if (!meItem) {
      return { ok: false, reason: 'Could not find (Me) participant entry' };
    }

    meItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(300);

    const moreBtn = meItem.querySelector('button[title="More"], button[aria-label*="More"], button[id*="dropdown"], button.btn.dropdown-toggle, .dropdown-toggle')
      || Array.from(meItem.querySelectorAll('button, div, span')).find(el => /more/i.test((el.textContent || '').trim()) && visible(el));
    if (!moreBtn) {
      return { ok: false, reason: 'More button not found' };
    }

    clickElement(moreBtn);
    await sleep(500);

    const renameBtn = Array.from(document.querySelectorAll('button, div'))
      .find(el => (el.textContent || '').trim() === 'Rename');
    if (!renameBtn) {
      return { ok: false, reason: 'Rename option not found' };
    }

    clickElement(renameBtn);
    await sleep(500);

    const input = document.querySelector('#newname') || document.querySelector('input[name="newname"]') || Array.from(document.querySelectorAll('input')).find(el => (el.placeholder || '').toLowerCase().includes('name'));
    if (!input) {
      return { ok: false, reason: 'Rename input field not found' };
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);

    const changeBtn = await waitFor(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
      return buttons.find(el => /\bchange\b/i.test((el.textContent || '').trim()) && el.className.includes('zm-btn'))
        || buttons.find(el => /\bchange\b/i.test((el.textContent || '').trim()));
    }, 5000);

    if (!changeBtn) {
      return { ok: false, reason: 'Change button not found in rename dialog' };
    }

    clickElement(changeBtn);
    await sleep(800);
    return { ok: true };
  }, name, timeout);

  if (!result.ok) {
    console.warn('Rename failed:', result.reason || 'unknown');
    return false;
  }
  console.log('Renamed to:', name);
  return true;
}

async function sendMessage(page, msg) {
  const editorSelectors = ['div.tiptap.ProseMirror','div[contenteditable="true"]','textarea.chat-box__chat-textarea','textarea','input[type="text"]'];
  const waitForAny = async (selectors, timeout=8000)=>{
    const end = Date.now()+timeout;
    while (Date.now()<end) {
      for (const f of page.frames()) {
        for (const s of selectors) {
          try { const el = await f.$(s); if (el) return {frame:f,selector:s,el}; } catch(e){}
        }
      }
      await new Promise(r=>setTimeout(r,300));
    }
    return null;
  };
  try {
    const found = await waitForAny(editorSelectors,10000);
    if (!found) { console.error('No editor found'); return false; }
    const {frame, selector, el} = found;
    try { await el.focus(); } catch(e){ await frame.evaluate(sel=>{ const e=document.querySelector(sel); if(e) e.focus(); }, selector); }
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(modifier); await page.keyboard.press('KeyA'); await page.keyboard.up(modifier); await page.keyboard.press('Backspace');
    try { await el.type(msg, {delay:40}); } catch(e) { await page.keyboard.type(msg,{delay:40}); }
    await new Promise(r=>setTimeout(r,200));
    // try send button
    const sendSel = await (async ()=>{
      const sendCandidates = ['button.chat-rtf-box__send','button[aria-label="Send"]','button[data-testid="send"]','button[type="submit"]'];
      for (const f of page.frames()) for (const s of sendCandidates) { try { const se = await f.$(s); if (se) return {frame:f,sel:s,el:se}; } catch(e){} }
      return null;
    })();
    if (sendSel) { try { await sendSel.el.click(); console.log('Sent via', sendSel.sel); return true; } catch(e){} }
    try { await el.press('Enter'); console.log('Sent via Enter'); return true; } catch(e){ await page.keyboard.press('Enter'); return true; }
  } catch (e) { console.error('sendMessage error', e.message); }
  return false;
}

(async function main(){
  const wsFile = path.join(__dirname, 'browser-ws-endpoint.txt');
  if (!fs.existsSync(wsFile)) { console.error('browser-ws-endpoint.txt not found. Run `npm run join`.'); process.exit(1); }
  const ws = fs.readFileSync(wsFile,'utf8').trim();
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null, ignoreHTTPSErrors: true, protocolTimeout: 120000 });
  console.log('Connected to existing browser');
  const pages = await browser.pages();
  let page = pages.find(p=> (p.url()||'').includes('events.zoom.us')) || pages.find(p=> (p.url()||'').includes('zoom.us')) || pages[pages.length-1];
  if (!page) { console.error('No page found'); await browser.disconnect(); process.exit(1); }
  await page.bringToFront();
  page.on('console', msg=>console.log('PAGE LOG:', msg.text()));

  let messages = parseJSONMessages();
  if (!messages.length) {
    messages = parseCSV();
    if (messages.length) {
      console.log('Loaded', messages.length, 'messages from messagelist.csv as fallback');
    }
  } else {
    console.log('Loaded', messages.length, 'messages from Test_JSONChat.json');
  }
  if (!messages.length) { console.error('No messages found in Test_JSONChat.json or messagelist.csv'); await browser.disconnect(); process.exit(1); }

  const participantReady = await ensureParticipantPanelOpen(page);
  if (!participantReady) {
    console.warn('Could not open the participants panel before starting. Continuing anyway.');
  }

  for (const row of messages) {
    const offset = timeOffsetToSeconds(row.timeoffset || row.offset || '0');
    const sender = (row['sender name'] || row['sender'] || row['sendername'] || '').trim();
    const message = (row.message || row.msg || row.text || '').trim();
    const when = Date.now() + offset*1000;
    const delay = when - Date.now();
    if (delay > 0) {
      console.log('Scheduling in', Math.round(delay/1000),'s:', sender, message.slice(0,60));
      await sleep(delay);
    }

    if (sender) {
      const participantReady = await ensureParticipantPanelOpen(page);
      if (!participantReady) {
        console.warn('Participants panel is not open; retrying once before rename.');
        await sleep(500);
        await ensureParticipantPanelOpen(page);
      }
      await renameCurrentUser(page, sender).catch(()=>{});
    }

    await sleep(400);
    const chatReady = await ensureChatPanelOpen(page);
    if (!chatReady) {
      console.warn('Could not open chat panel before sending message. Continuing anyway.');
    }
    await sendMessage(page, message).catch(()=>{});
    await sleep(600);
  }
  console.log('Done sending messages');
  // keep browser open; disconnect
  await browser.disconnect();
})();
