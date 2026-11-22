# Thespia HUD (Blueprint Help v1)

A Meta Ray-Ban Display Web App: a glasses home screen with **Blueprint Help** for Unreal Engine 5.6 (Blueprints only) and **Talk to Major**. Built for Thespia.

The static site is meant to be served from the repository root on GitHub Pages (`index.html` at `/`). The optional Python server is only for local preview and AI answers; it is not required for the glasses app.

## Preview on a computer

```bash
python3 server/ask_server.py
```

Then open http://127.0.0.1:8765/

A large window shows a 600×600 preview frame and keyboard hints. To preview at the exact glasses viewport, open Chrome DevTools and set the device size to 600×600.

Keyboard stand-ins for the Neural Band / Cap Touch:

- **Left / Right** — previous or next recipe step, or Talk to Major reply card
- **Up / Down** or **Tab** — move between buttons (and spatial navigation if you start Chrome with `--enable-spatial-navigation`)
- **Enter** — activate the focused button, or submit the question, message, recipe title, or step field

Optional: the [Meta Ray-Ban Display Simulator](https://wearables.developer.meta.com/docs/develop/webapps/test/) Chrome extension can preview the additive display. It is not a substitute for device testing, and it does not reproduce the composer or the Neural Band exactly.

Run the local checks:

```bash
python3 scripts/test_v1.py
```

That command also runs the privacy scan (`scripts/privacy_scan.py`).

## Home screen

The app opens to a HUD home screen:

- A clock and date, updated on the device
- A **Next up** line you can set. It is stored in `localStorage` on the glasses (or the preview browser) only
- A tile grid: **Blueprint Help** and **Talk to Major** work now. **Overlock Walk**, **Photo to Texture**, **Scale Check**, and **3D Scan** are marked Coming soon

## Your own Blueprint recipes

In **Blueprint Help**, choose **New recipe**. Enter a title, then add steps one at a time (the `search` and `text` fields open on-glasses dictation). **Add step** keeps you on the editor; **Done** saves the recipe on this device. You can edit or delete a saved recipe, and your recipes show up in search results and Favorites.

**Export / Import** copies your recipes as a JSON text blob for backup, or pastes a backup back in. Custom recipes stay in `localStorage` only. Do not paste personal or work data into a recipe if you later share a screenshot or backup file.

## Talk to Major

The chat panel uses a `type=search` field so the on-glasses composer (and dictation) can open, a Send button, short reply cards you page with Left/Right, and optional read-aloud.

There is no official public chat API for Grok Bot in this app. Live replies need a bridge you control, pasted in Settings on the device. Until then, a mock transport returns practice replies and sends nothing off the device. The shipped code contains no endpoint URLs, tokens, or secrets. See [docs/talk-to-major.md](docs/talk-to-major.md) for the design and the recommended bridge.

## AI answers for Blueprint Help (optional)

The offline recipe library works with no key and no backend. To enable AI later, copy `server/.env.example` to `server/.env` and set `AI_API_KEY`. You can also set `AI_BASE_URL` and `AI_MODEL` (OpenAI-compatible). Do not commit a real key.

`GET /api/health` reports whether a key is configured. `POST /api/ask` with `{"question":"..."}` returns `{title, nodes, steps}`. If the key is missing, that route returns 503 and the Web App stays on the library.

## Add it on the glasses

The app must be on a public HTTPS URL (GitHub Pages once enabled). In the Meta AI app, with Developer Mode on: App Settings → Apps → Web Apps → Connect Web App → paste the Pages URL.

## Privacy

This repo is meant to be public. Do not put personal information, work CSVs, passwords, API keys, or customer data in these files. Favorites, your recipes, Next up, and Talk to Major settings stay in `localStorage` on the device. A live bridge URL or token, if you add one, is entered on the glasses and is never part of this source.

## What this app assumes from Meta's docs

Read on 22 Nov 2026 from the [Meta Wearables Web Apps](https://wearables.developer.meta.com/docs/develop/webapps/) guides.

- Display is an additive 600×600 waveguide. Use a black canvas and high-contrast bounded surfaces. Size from the viewport; treat 600×600 as a validation target.
- Neural Band and Cap Touch become `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, and `Enter`. The browser moves focus; Enter activates the focused control.
- Web Apps cannot use the microphone. Voice input uses the on-glasses composer (activate the search field to dictate). That needs firmware v127+ and Meta AI app v272+.
- Text to speech uses `window.speechSynthesis`. Favorites and Next up use `localStorage`. A service worker can cache the app shell after a first online visit.
- The glasses app icon comes from `.well-known/meta-wearables-manifest.json`. This repo includes a `.nojekyll` file so Pages serves that folder.

## File list

- `index.html`, `styles.css`, `app.js` — HUD home screen, Blueprint Help, and Talk to Major
- `major-transport.js` — pluggable message transport (mock preview, optional on-device HTTPS bridge)
- `library.json` — 15 UE 5.6 Blueprint recipes
- `sw.js` — offline app-shell cache
- `icons/` — monochrome PNG icons (64, 128, 512)
- `.well-known/meta-wearables-manifest.json` — glasses app name and icon
- `.nojekyll` — tell GitHub Pages not to run Jekyll
- `docs/talk-to-major.md` — how a glasses app can reach Major, and the recommended bridge
- `server/ask_server.py` — local static server plus optional `/api/ask`
- `server/.env.example` — AI key placeholder (no real key)
- `scripts/test_v1.py` — local load checks
- `scripts/privacy_scan.py` — reject keys, emails, and personal data in shipped files
