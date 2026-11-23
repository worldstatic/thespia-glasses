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


## One-tap setup link

After the app update is published, a setup link can turn on the live relay in one tap, without typing the URL or token on the glasses.

The link uses only a URL fragment, never a query string, so the token is not sent to GitHub Pages or any other server:

`https://worldstatic.github.io/thespia-glasses/#talk-setup=<payload>`

The payload is the base64url encoding of a JSON object shaped like `{ "relayUrl": "https://your-worker.example", "token": "your-device-token" }`. Use placeholder values here; never put a real token or Worker URL in this repository.

When the app loads that link it:

1. Reads `location.hash` only
2. Checks that `relayUrl` is an `https:` URL and that a token is present
3. Saves the config on the device through the Talk transport (`kind` is `relay`)
4. Clears the fragment right away with `history.replaceState` (it does not use `pushState`)
5. Shows a short card: “Talk is set up. Live relay is on.”

If the link is invalid, the fragment is still cleared and existing Talk settings are left unchanged. The service worker never sees or caches the fragment. The app does not log the token.

Anyone who has a real setup link can message your relay, so treat it like a password and delete it after you have opened it once on the glasses (or in the Meta app browser). You can still paste the same values by hand in Talk → Settings.

## Privacy

Do not put work CSVs, customer data, passwords, or personal files in Talk, in this repo, or in Worker logs. The Worker is written not to log message text. Rotate the device and reply tokens if one is ever shared by mistake.

## What not to do

- Do not commit a webhook key, device token, or Worker URL to this repository.
- Do not expose a port on the computer to the internet, and do not rely on unofficial internal gateways.
- Do not treat a webhook `200` as “the reply is ready.”
