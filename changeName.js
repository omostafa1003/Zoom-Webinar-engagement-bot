const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--name=')) args.name = arg.split('=')[1];
    else if (arg.startsWith('--names=')) args.names = arg.split('=')[1].split('|').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--url=')) args.url = arg.split('=')[1];
    else if (arg.startsWith('--ws=')) args.ws = arg.split('=')[1];
    else if (arg.startsWith('--timeout=')) args.timeout = Number(arg.split('=')[1]) || 30000;
    else if (arg.startsWith('--retries=')) args.retries = Number(arg.split('=')[1]) || 3;
  });
  return args;
}

function usage() {
  console.log('Usage:');
  console.log('  node changeName.js --name="New Name"');
  console.log('  node changeName.js --names="Name1|Name2"');
  console.log('Optional: --ws=wsEndpoint --timeout=30000');
  console.log('Note: `npm run join` must be run first to create browser-ws-endpoint.txt.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getWsEndpoint() {
  const arg = process.argv.find(a => a.startsWith('--ws='));
  if (arg) return arg.split('=')[1];
  const endpointFile = path.join(__dirname, 'browser-ws-endpoint.txt');
  if (fs.existsSync(endpointFile)) return fs.readFileSync(endpointFile, 'utf8').trim();
  return null;
}

async function connectBrowser(ws) {
  return puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null, protocolTimeout: 120000 });
}

async function getWebSdkFrame(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const frames = page.frames();
    const frame = frames.find(f => f.name() === 'websdk' || f.url().includes('/websdk') || f.url().includes('/e/sessionView/'));
    if (frame) return frame;
    await sleep(250);
  }
  return null;
}

async function renameCurrentUser(page, name, timeout = 30000) {
  const frame = await getWebSdkFrame(page, timeout);
  if (!frame) return { ok: false, reason: 'websdk frame not found' };

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
      const selectors = [
        '#participant > button',
        'button[aria-label*="participants list pane"]',
        'button[aria-label*="Participants"]',
        'button[title*="Participants"]',
        'button[aria-label*="open the participants list pane"]'
      ];
      let button = selectors.map(s => document.querySelector(s)).find(el => el && visible(el));
      if (!button) {
        const allButtons = Array.from(document.querySelectorAll('button')).filter(visible);
        button = allButtons.find(el => /participants/i.test(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`));
      }
      if (!button) return null;
      clickElement(button);
      await sleep(500);
      return await waitFor(() => {
        const panel = document.querySelector('.participants-panel, .participants-container, #participants-ul, .participants-ul, .show-participants');
        return panel && visible(panel) ? panel : null;
      }, 5000);
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

    const directRenameBtn = Array.from(meItem.querySelectorAll('button'))
      .find(el => visible(el) && /rename/i.test((el.textContent || '').trim()));
    if (directRenameBtn) {
      clickElement(directRenameBtn);
      await sleep(500);
    } else {
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
    }

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

  return result;
}

(async () => {
  const args = parseArgs();
  if (!args.name && !args.names) {
    usage();
    process.exit(1);
  }

  const ws = args.ws || getWsEndpoint();
  if (!ws) {
    console.error('A running browser session is required. Run `npm run join` first to create browser-ws-endpoint.txt, or pass --ws.');
    usage();
    process.exit(1);
  }

  const browser = await connectBrowser(ws);
  let page;
  try {
    const pages = await browser.pages();
    page = pages[0];
    if (!page) throw new Error('No browser page available');

    const names = args.names || [args.name];
    let success = true;
    for (const name of names) {
      console.log('Renaming to:', name);
      const result = await renameCurrentUser(page, name, args.timeout || 30000);
      if (result.ok) {
        console.log(`Rename succeeded: '${name}'`);
      } else {
        console.error('Rename failed:', result.reason);
        success = false;
        break;
      }
      await sleep(1000);
    }

    if (ws) {
      await browser.disconnect();
    } else {
      console.log('Closing launched browser.');
      await browser.close();
    }

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('Error:', error.message || error);
    if (ws) {
      await browser.disconnect();
    } else {
      await browser.close();
    }
    process.exit(1);
  }
})();
