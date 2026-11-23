# World Static

A Meta Ray-Ban Display Web App: a glasses home screen named **World Static**, with **Task Cards**, a **Teleprompter**, **Blueprint Help** for Unreal Engine 5.6 (Blueprints only), **Scale Check**, and **Talk** (Major or C 2). Built for Thespia work, and for general use at work or home.

The static site is meant to be served from the repository root on GitHub Pages (`index.html` at `/`). The optional Python server is only for local preview and AI answers; it is not required for the glasses app.

## Preview on a computer

```bash
python3 server/ask_server.py
```

Then open http://127.0.0.1:8765/

A large window shows a 600×600 preview frame and keyboard hints. To preview at the exact glasses viewport, open Chrome DevTools and set the device size to 600×600.

Keyboard stand-ins for the Neural Band / Cap Touch:

- **Left / Right** — previous or next recipe step, Scale Check library entry, Task Cards list, or Teleprompter segment. On the Scale Check converter readout, Left/Right change the step size and Up/Down change the value. In a Talk thread, Up/Down on the thread scrolls older or newer messages
- **Up / Down** or **Tab** — move between buttons, move through tasks, or change teleprompter speed (and spatial navigation if you start Chrome with `--enable-spatial-navigation`)
- **Enter** — activate the focused button, mark a task done, pause or resume the teleprompter, or submit a dictated field

Optional: the [Meta Ray-Ban Display Simulator](https://wearables.developer.meta.com/docs/develop/webapps/test/) Chrome extension can preview the additive display. It is not a substitute for device testing, and it does not reproduce the composer or the Neural Band exactly.

Run the local checks:

```bash
python3 scripts/test_v1.py
```

That command also runs the privacy scan (`scripts/privacy_scan.py`).

## Home screen

The app opens to a glanceable **World Static** dashboard (no app tiles on home):

- A dim, outline-treated crop of Thespia campaign art (the colony quarters with a cyan ore vein and a viewport to the chained hulls) sits behind the UI. It is darkened for the additive 600×600 display, where black reads as transparent, so the clock and cards stay readable. The source is official Thespia concept art already made for the game — no people, no workplace photos, and no personal information
- The World Static logo and wordmark, a large clock, and the date, updated on the device
- The current **Task** card from your Task Cards data (soonest due day first). Open it to jump to that task
- **Daily funds**: today's budget, spent, and remaining, with a simple bar. **Add spend** is on the home footer: type an amount in a `type=search` field and press Enter to add it to the running total. You can set the budget from the funds card. Spent resets at local midnight; a short history stays on the device. Nothing is sent anywhere
- **Next up**: one schedule line you set (the next stream or shift), stored in `localStorage`
- A short line with the last message from Major or C 2
- One primary **Apps** button

App tiles live on a separate **Apps** screen: **Task Cards**, **Teleprompter**, **Blueprint Help**, **Scale Check**, and **Talk** work now. **3D Scan** and **Overlock Walk** are marked Coming soon. **Home** returns to the dashboard.

## Task Cards

General-purpose lists, defaulting to **Work**, **Home**, and **Projects**. You can create and rename lists. Each task has a title (dictate in a `search` field), an optional note, done/undone, and an optional due day (`today`, `Friday`, or `Nov 25`).

Left/Right switch lists. Up/Down move through tasks. Enter marks the selected task done or opens it from the list. **Actions** can edit, move, reorder, or delete a task. **Lists** can rename or add a list, clear done tasks, or export and import a JSON backup. Progress is shown per list. Everything stays in `localStorage` on this device.

The shipped seed tasks are generic examples only. Do not put work CSVs or customer data into a backup you share.

## Teleprompter

For talking points while you stream game dev. Create, edit, or delete scripts (title plus body). Dictate a line into the search field, or paste the full script. **Export / Import** accepts a JSON backup or a plain-text / `.txt` script.

**Play** shows large high-contrast text scrolling on a black background. Enter pauses or resumes, Up/Down change speed, and Left/Right jump to the previous or next paragraph or segment. Lines that start with `## ` become segments. A time like `## Intro 2m` sets a per-segment target, shown next to the elapsed timer. You can change the text size on the script screen.

One generic **Stream intro** script is included as an example.

## Your own Blueprint recipes

In **Blueprint Help**, choose **New recipe**. Enter a title, then add steps one at a time (the `search` and `text` fields open on-glasses dictation). **Add step** keeps you on the editor; **Done** saves the recipe on this device. You can edit or delete a saved recipe, and your recipes show up in search results and Favorites.

**Export / Import** copies your recipes as a JSON text blob for backup, or pastes a backup back in. Custom recipes stay in `localStorage` only. Do not paste personal or work data into a recipe if you later share a screenshot or backup file.

## Scale Check

**Scale Check** is a walking reference for real-world sizes next to Unreal Engine 5.6 units (`1 uu = 1 cm`). It is meant for Thespia level design (FPS, RTS, and base building).

- **Reference library** — doors, stairs and ramps, ceilings and floors, cover heights, counters, vehicles, fences and walls, and character defaults. Each entry shows feet/inches, centimeters, and uu, plus a short level-design tip. Values are labeled as a standard, a code figure, a UE 5.6 default, a typical range, or a convention (not a measurement).
- **Converter** — change a value with Up/Down, change the step with Left/Right, or dictate a size such as `6 ft 8` or `203 cm` in the search field. The readout shows feet/inches, cm, uu, meters, and a percentage of Manny’s 180 cm reference height.
- **Pace measure** — set your stride once (default 75 cm) and press Enter to count steps while you walk. The total is shown in uu.
- **My measurements** — save a named size on this device, then export or import a JSON text blob, the same way as custom Blueprint recipes.

Favorites, recipes, tasks, scripts, measurements, and your stride stay in `localStorage` on the device.

## Talk (Major or C 2)

The Talk tile opens a picker with original outline avatars for **Major** and **C 2**. Each person has a separate messenger-style thread stored in `localStorage` on the device (newest 50 messages). Your messages sit on the right; their replies sit on the left with the small avatar and a short timestamp. The composer is a `type=search` field so the on-glasses composer (and dictation) can open, plus a Send button. Press Enter in the field to send. Optional read-aloud speaks the latest reply. After you send, your bubble appears at once, then “Major is typing…” or “C 2 is typing…” until the reply arrives. If the wait times out, a “No reply yet. Tap to check again.” bubble re-polls the same message.

There is no official public chat API for Grok Bot in this app. Live replies use a Cloudflare Worker you control, with the Worker URL and device token pasted in Settings on the device (`type=search` fields). Until that is configured, a mock transport returns practice replies and sends nothing off the device. The shipped code contains no endpoint URLs, tokens, or secrets. A one-tap setup link can also store those values from a URL fragment; see [docs/talk-to-major.md](docs/talk-to-major.md).

## AI answers for Blueprint Help (optional)

The offline recipe library works with no key and no backend. To enable AI later, copy `server/.env.example` to `server/.env` and set `AI_API_KEY`. You can also set `AI_BASE_URL` and `AI_MODEL` (OpenAI-compatible). Do not commit a real key.

`GET /api/health` reports whether a key is configured. `POST /api/ask` with `{"question":"..."}` returns `{title, nodes, steps}`. If the key is missing, that route returns 503 and the Web App stays on the library.

## Add it on the glasses

The app must be on a public HTTPS URL (GitHub Pages once enabled). In the Meta AI app, with Developer Mode on: App Settings → Apps → Web Apps → Connect Web App → paste the Pages URL.

## Privacy

This repo is meant to be public. Do not put personal information, work CSVs, passwords, API keys, or customer data in these files. Favorites, your recipes, Task Cards, Teleprompter scripts, Scale Check measurements, your stride, Talk settings and threads, daily funds, and Next up stay in `localStorage` on the device. A live relay URL or token, if you add one, is entered on the glasses and is never part of this source.

## What this app assumes from Meta's docs

Read on 22 Nov 2026 from the [Meta Wearables Web Apps](https://wearables.developer.meta.com/docs/develop/webapps/) guides.

- Display is an additive 600×600 waveguide. Use a black canvas and high-contrast outlined surfaces. Size from the viewport; treat 600×600 as a validation target.
- Neural Band and Cap Touch become `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, and `Enter`. The browser moves focus; Enter activates the focused control.
- Web Apps cannot use the microphone. Voice input uses the on-glasses composer (activate the search field to dictate). That needs firmware v127+ and Meta AI app v272+.
- Text to speech uses `window.speechSynthesis`. App data uses `localStorage`. A service worker can cache the app shell after a first online visit.
- The glasses app icon comes from `.well-known/meta-wearables-manifest.json`. This repo includes a `.nojekyll` file so Pages serves that folder. The app name and short name are **World Static**.

## File list

- `index.html`, `styles.css`, `app.js`, `funds.js` — World Static dashboard, Apps, Task Cards, Teleprompter, Blueprint Help, Scale Check, Talk, and daily funds
- `tasks.js` — Task Cards storage, due-day parsing, and export/import
- `prompter.js` — Teleprompter storage, segment parsing, and export/import
- `major-transport.js` — pluggable message transport (mock preview, optional on-device HTTPS bridge)
- `scale.js` — length parsing, unit conversion, and measurement storage helpers
- `library.json` — 15 UE 5.6 Blueprint recipes
- `scale-library.json` — Scale Check reference sizes and tips
- `manifest.webmanifest` — app name, short name, and 192/512 icons
- `sw.js` — offline app-shell cache
- `icons/` — World Static logo (SVG source, PNG favicon and 192/512 app icons, plus a monochrome 512 for the glasses launcher)
- `.well-known/meta-wearables-manifest.json` — glasses app name and icon
- `.nojekyll` — tell GitHub Pages not to run Jekyll
- `docs/talk-to-major.md` — how a glasses app can reach Major, and the recommended bridge
- `server/ask_server.py` — local static server plus optional `/api/ask`
- `server/.env.example` — AI key placeholder (no real key)
- `scripts/test_v1.py` — local load checks
- `scripts/privacy_scan.py` — reject keys, emails, and personal data in shipped files
