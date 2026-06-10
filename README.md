# Zoom Web Client Automation

This project contains Puppeteer scripts to join a Zoom web meeting, raise your hand, accept panelist promotion, handle follow-up prompts, and send scheduled chat messages.

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
- `npm run change-name`

## How to use

### 1) Save the meeting URL

Create or update `meeting-link.txt` with your Zoom join URL.

### 2) Open the meeting in browser

This opens Chrome, navigates to the meeting link, and optionally closes non-webinar tabs.

```bash
npm run join -- --close-others
```

If you want to override the saved link:

```bash
npm run join -- --url="YOUR_JOIN_LINK" --close-others
```

### 3) Raise your hand and accept panelist promotion

Run this after `npm run join` is running and the browser is open.

```bash
npm run raise-hand
```

This script will:

- detect and click the raise-hand button
- monitor when the host lowers your hand
- auto-click the `Join as Panelist` accept button
- auto-click any `Continue without microphone and camera` prompts
- auto-click the `Cancel` button on a `Leave site` popup if it appears

### 4) Start sending scheduled chat messages

Run this after the browser is already open and connected.

```bash
npm run start-messaging
```

If you need to override the saved meeting URL:

```bash
npm run start-messaging -- --url="YOUR_JOIN_LINK"
```

### 5) Change your panelist display name

Run this after you have been promoted to panelist and the browser is still attached.

```bash
npm run change-name -- --name="Test Name"
```

Or use multiple names in sequence:

```bash
npm run change-name -- --names="Hans Müller|Anna Schmidt|Karl Fischer"
```

## Script details

- `joinMeeting.js`
  - launches a browser
  - opens the meeting URL from `meeting-link.txt` or `--url`
  - clicks "Join from your browser" if needed
  - writes `browser-ws-endpoint.txt` for later attachment
  - supports `--close-others` to close other pages

- `raiseHand.js`
  - connects to the running browser via `browser-ws-endpoint.txt`
  - finds the raise-hand UI and clicks it
  - watches for panelist promotion flow and accept buttons
  - handles camera/microphone continue prompts
  - handles leave-site confirmation dialogs

- `sendScheduledMessages.js`
  - connects to the running browser via `browser-ws-endpoint.txt`
  - opens the chat panel if needed
  - finds the chat editor and sends scheduled messages using keystrokes

## Customization

- Edit `sendScheduledMessages.js` to change message timing and content.
- If your Zoom UI differs, update selectors in `sendScheduledMessages.js` or `raiseHand.js`.

## Notes

- Keep `npm run join` running while you use the other scripts.
- `raiseHand.js` and `sendScheduledMessages.js` attach to the existing browser session.
- If the browser closes, you need to re-run `npm run join`.
