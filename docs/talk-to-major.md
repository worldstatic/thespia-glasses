# Talk — Major and C 2

This note is for the **World Static** glasses app. The chat UI, picker, avatars, and a pluggable transport live in this public repo. The Cloudflare Worker that carries live messages is kept in a **private folder outside this repo**. No tokens, webhook URLs, or keys belong here.

Facts below were checked on 22 Nov 2026 against official Grok Bot help ([Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations)) and [Meta Wearables Web Apps](https://wearables.developer.meta.com/docs/develop/webapps/).

## What the glasses app does

- The **Talk** tile opens a picker: **Major** or **C 2**, each with an original outline avatar (cyan command chevron for Major, violet orb and amber monogram for C 2).
- Each person has a separate thread in `localStorage` (`thespia.hud.talk.threads`).
- The composer is a `type=search` field so on-glasses dictation can open. Replies are short cards, paged with Left/Right, with optional read-aloud.
- While waiting on a live reply, the display shows “Major is thinking...” or “C 2 is thinking...” and times out after about three minutes.
- `major-transport.js` has two built-in modes:
  1. **mock** (default). Practice replies. Nothing leaves the device.
  2. **relay**. `POST { "text", "to" }` to your Worker `/ask`, then poll `/poll?id=...` with the device token. `to` is `major` or `c2`.

Settings stores only a Worker URL and device token in `localStorage`. The shipped source has no endpoint URLs or secrets.

## Live setup

Do this after the Worker is deployed and the glasses app is on GitHub Pages (`https://worldstatic.github.io/...`). CORS on the Worker is limited to that origin, so live replies will not work from a `localhost` preview.

1. Create one Grok Bot webhook routine on Major (desktop app). After you save it, copy **POST to** (the URL) and **key**. Official docs say senders include the key as `Authorization: Bearer <key>`. The panel also has a **header** field with that full line.
2. Put those values, plus the device and reply tokens, on the Worker as secrets. The Worker forwards `{ id, text, to }` to that single webhook.
3. Routine instruction: if `to` is `c2`, Major forwards the message to C 2, waits for C 2's answer, and posts it back tagged as C 2. If `to` is `major`, Major answers and posts tagged as Major. A `200` from the webhook only means the run started.
4. On the glasses, open Talk → Settings, choose **Live relay**, and paste:
   - the Worker base URL (no path)
   - the device token
   Activate each field to dictate or type (`type=search`). Save. These stay on the device only.

Preview mode remains available as a fallback if Settings are cleared.

## Privacy

Do not put work CSVs, customer data, passwords, or personal files in Talk, in this repo, or in Worker logs. The Worker is written not to log message text. Rotate the device and reply tokens if one is ever shared by mistake.

## What not to do

- Do not commit a webhook key, device token, or Worker URL to this repository.
- Do not expose a port on the computer to the internet, and do not rely on unofficial internal gateways.
- Do not treat a webhook `200` as “the reply is ready.”
