# Zoom Web Client Automation

This project contains Puppeteer scripts to join a Zoom web meeting, raise your hand, accept panelist promotion, change your display name, and send scheduled chat messages.

## Setup

1. Ensure Node.js is installed (Node 16+ recommended).
2. Install dependencies from the project folder:

```bash
npm install
```

## Supported scripts

- `npm run join`
- `npm run raise-hand`
- `npm run start-messaging`
- `npm run csv-messaging`
- `npm run change-name`

## How to use

### 1) Save the meeting URL

Create or update `meeting-link.txt` with your Zoom join URL.

### 2) Open the meeting in browser

This opens Chrome, navigates to the meeting link, and keeps the browser open for later attachment.

```bash
npm run join -- --close-others
```

If you want to override the saved link:

```bash
npm run join -- --url="YOUR_JOIN_LINK" --close-others
```

The join script writes `browser-ws-endpoint.txt` and remains running so other scripts can attach to the same browser session.

### 3) Raise your hand and accept panelist promotion

Run this after `npm run join` is running and the browser is open.

```bash
npm run raise-hand
```

This script will:

- detect and click the raise-hand button
- monitor promotion flow and accept panelist join prompts
- handle "Continue without microphone and camera" prompts
- dismiss "Leave site" or similar confirmation dialogs

### 4) Start sending scheduled chat messages

Run this after the browser is already open and connected.

```bash
npm run start-messaging
```

If you need to override the saved meeting URL:

```bash
npm run start-messaging -- --url="YOUR_JOIN_LINK"
```

The messaging script tries to attach to the existing browser via `browser-ws-endpoint.txt`. If no browser is available, it may launch a new browser instance.

### 5) Send chat messages from JSON

Use this script to read a schedule from `Test_JSONChat.json`.

```bash
npm run csv-messaging
```

The script now loads `Test_JSONChat.json` by default and falls back to `messagelist.csv` if the JSON file is unavailable.

### 6) Change your panelist display name

Run this after you have been promoted to panelist and the browser is still attached.

```bash
npm run change-name -- --name="Test Name1"
```

Or use multiple names in sequence:

```bash
npm run change-name -- --names="Hans Müller|Anna Schmidt|Karl Fischer"
```

You can also pass `--ws="YOUR_WS_ENDPOINT"` if you want to attach to a specific browser websocket endpoint instead of the saved `browser-ws-endpoint.txt`.

## Script details

- `joinMeeting.js`
  - launches a browser
  - opens the meeting URL from `meeting-link.txt` or `--url`
  - clicks "Join from your browser" if needed
  - writes `browser-ws-endpoint.txt` for later attachment
  - closes other pages to reduce confusion
  - stays running so the browser session remains available

- `raiseHand.js`
  - connects to the running browser via `browser-ws-endpoint.txt` or `--ws`
  - finds the raise-hand button across pages and frames
  - clicks it and monitors the meeting UI for promotion dialogs
  - dismisses leave-site confirmation dialogs

- `sendScheduledMessages.js`
  - connects to the running browser via `browser-ws-endpoint.txt` when available
  - opens the chat panel if needed
  - finds the chat editor and sends scheduled messages using keystrokes
  - can also launch a new browser if no existing session is available

- `sendMessagesFromCSV.js`
  - reads `messagelist.csv`
  - parses rows with `timeoffset`/`offset` and `message`
  - sorts entries by offset and sends each message at the scheduled time

- `changeName.js`
  - connects to the running browser via `browser-ws-endpoint.txt` or `--ws`
  - opens the participants panel
  - selects your own participant entry and renames it

## Customization

- Edit `sendScheduledMessages.js` to change hard-coded message timings and content.
- Edit `messagelist.csv` to customize CSV-driven message timing and content.
- If your Zoom UI differs, update selectors in `sendScheduledMessages.js`, `raiseHand.js`, or `changeName.js`.

## Notes

- Keep `npm run join` running while you use the other scripts.
- `raiseHand.js`, `sendScheduledMessages.js`, and `changeName.js` attach to the existing browser session through `browser-ws-endpoint.txt`.
- If the browser closes, re-run `npm run join` to recreate the session endpoint.
- `npm run csv-messaging` reads `messagelist.csv` from the project folder.
