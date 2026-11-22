# Talk to Major — bridge design

This is a design note only. No routine, webhook, account, tunnel, or channel was created while writing it. The glasses app ships a chat UI and a pluggable transport. Live delivery is optional and is configured on the device.

Facts below were checked on 22 Nov 2026 against official Grok Bot help ([Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps), [Message and collaborate](https://docs.x.ai/grok-bot/chat-and-collaboration)) and [Meta Wearables Web Apps](https://wearables.developer.meta.com/docs/develop/webapps/).

## Constraints

- There is no official public “chat with my Grok Bot from an outside app” HTTP API.
- Glasses web apps can use `fetch` and WebSocket over Wi-Fi or a phone tether. They cannot use the microphone, camera, or notifications. They only load public HTTPS pages.
- Voice input is the on-glasses composer, opened by activating a text field (`type=search` in this app). Replies can be read aloud with `speechSynthesis`.
- A Grok Bot routine can start from a **webhook** call or from **email** to the Bot's own address. A `200` from a webhook means a run started, not that the Bot finished. The result is written in the Bot's chat, not returned in that HTTP response.
- Email the Bot sends from a routine waits as a draft until you press Send. There is no unattended sending.
- A personal Bot messaged in its own Slack DM replies in the Grok Bot app, not in Slack. A Team Bot can reply in the same Slack thread.
- This repo will be public. No endpoint URLs, tokens, or secrets belong in the source. Settings are pasted on the glasses and stored in `localStorage`.

The missing official piece is a place the glasses can **read the reply**. Inbound paths can wake Major. They do not, by themselves, give the web app the answer.

## What the glasses app already does

`major-transport.js` defines a small contract:

1. **mock** (default). Returns short practice cards. Nothing is sent off the device. Use this for desktop and first glasses tests.
2. **http**. If you later paste an HTTPS URL (and optional token and poll URL) in Settings, the app `POST`s `{ "message", "requestId" }`. It accepts either an immediate `{ "cards": [...] }` or `{ "reply": "..." }`, or it polls your poll URL until a reply appears.

The bridge you host must speak HTTPS, allow this app's origin (CORS, including `OPTIONS`), and must not be committed to this repo.

## Ranked options

### 1. Recommended: your own HTTPS relay plus a webhook routine

**How it would work later (not built now).** You would ask Major to add a webhook-triggered routine whose instruction is: take the message from the webhook body, answer in short cards for a 600×600 HUD, then POST that reply back to your relay. A small worker you own (for example a Cloudflare Worker) would:

- accept `POST` from the glasses with a device token
- wake the routine with the official webhook `POST` and bearer key (those stay in the worker, never in this repo)
- store the later callback / reply under the `requestId`
- answer the glasses' poll with `{ "status": "done", "cards": [...] }`

**What you would need:** a free Cloudflare account (or any host you control), a webhook routine on Major (created later, in the Grok Bot desktop app, where the POST URL and key are shown), and a one-time paste of your relay URL and device token into Settings on the glasses. CORS must allow the public Pages origin.

**Cost:** usually free on a worker free tier. Each routine run also spends Grok Bot usage. Official limits: 200 runs an hour per routine, 300 across all routines.

**Privacy:** messages would pass through a server you control and through Grok Bot. That is the smallest extra surface if you keep the worker private, rotate the device token, and never put work CSVs or customer data in a chat. Do not use a shared third-party “paste” host for replies.

**Latency:** the webhook `200` is immediate; the useful reply depends on how long the run takes. Plan for tens of seconds, sometimes a couple of minutes, then a short poll.

This is the best fit because the inbound path is official, the glasses can only read public HTTPS, and you keep the secrets off the public repo and off the glasses source.

### 2. Email trigger to the Bot's address

**How it would work.** Grok Bot can claim one address at `mail.grokbot.com` (for example `yourname@mail.grokbot.com`). A routine can run when mail arrives, optionally only from allowed senders. Routines cannot filter by subject. New mail does not wake a Bot without that routine.

**What you would need:** claim the address, create an email-triggered routine, and some way for the glasses to send email. A browser page cannot speak SMTP, so you would still need a mail-sending relay. Replies cannot come back by email on their own: routine-sent mail waits as a draft until you approve it.

**Cost:** the address is part of Grok Bot. A mail relay may be free or paid. Each run spends usage.

**Privacy:** anyone can send mail to the address. Keep the allowed-sender list tight. Mail bodies are another copy of your messages.

**Latency:** worse than a webhook. Mail delivery, routine start, and a manual send approval add minutes, and they block a hands-free walk-around loop.

Useful as a backup wake-up path, not as the primary HUD chat.

### 3. Slack (only a Team Bot is truly two-way)

**How it would work.** Slack is an official place to message some Bots. A Team Bot can be mentioned in a channel or DM and can reply in that same Slack thread. A personal Bot, messaged in its own Slack DM, replies in the Grok Bot app instead of Slack, so the glasses would still not see the answer there.

**What you would need:** Slack connected on the Cursor account, almost certainly a Team Bot (not the personal Major chat), a Slack token, and still a tiny HTTPS proxy because Slack's API is not meant to be called with a secret from a public web app (CORS and token exposure).

**Cost:** Slack itself may be free; you would still spend Grok Bot usage. More accounts to set up.

**Privacy:** Slack would hold the messages. A token in glasses `localStorage` is weaker than a token kept only on a relay you control. This is a larger surface than option 1.

**Latency:** often faster than email once a Team Bot replies in-thread, but the glasses still need a proxy to read that thread, so end-to-end time is similar to a webhook relay.

Skip this unless you already want Major in Slack as a Team Bot for other reasons.

## What not to do

- Do not put a webhook key, relay token, or customer list in this repository.
- Do not expose a port on the computer to the internet, and do not rely on unofficial internal gateways.
- Do not treat a webhook `200` as “Major has answered.”

## Suggested order when you are ready

1. Try Talk to Major in the desktop preview and on the glasses with the mock transport.
2. When you want live replies, we can set up option 1 with you: a worker you own, a webhook routine, and a Settings paste on the glasses. Nothing in that step needs to be public in this repo.
