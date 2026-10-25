# PWA and offline work

The web app is also an installable Progressive Web App — no separate native UI. After the first online start it works without a
connection: building, interiors, furniture, materials, doors, electrical planner (with PDF export), variants. The phone gets the
app from this computer over USB; installing and updating it on a phone is described in [PHONE.md](PHONE.md)
.

## 1. Parts

| Part | Where | Description |
|---|---|---|
| manifest | `/manifest.webmanifest` (source: `MANIFEST` in `src/pwa/build.ts`) | "Home Simulator", `display: standalone`, `start_url` and `scope` `/`, colours, shortcut "Electrical plan" (`/?section=electrical`) |
| icons | `/icons/*` (source: `src/pwa/icons/`) | 192 / 512 regular and maskable |
| service worker | `/sw.js` (source: `src/pwa/sw.ts`, rules: `src/pwa/routes.ts`) | complete offline cache per version, user files from the device, controlled updates |
| build plugin | `src/pwa/build.ts` (in `vite.config.ts`) | version file list, version id, building `sw.js`, `pwa-build.json` |
| registration and updates | `src/pwa/register.ts` | PWA state, checking and applying updates, install prompt |
| UI | `src/pwa/PwaUi.tsx` | update banner, version choice on conflict, Settings → "App and data" |
| device storage | `src/storage/db.ts`, `project.ts`, `assets.ts` | IndexedDB: user document, backups, user files |
| document sync | `src/document/store.ts` (client), `src/document/server.ts` (save server) | document file ↔ device, offline, sync, conflicts |

`index.html`: `viewport-fit=cover`, `theme-color`, manifest link, icons. Safe areas (`--sa-t / --sa-b / --sa-l / --sa-r` =
`env(safe-area-inset-*)`) are filled by the device in the standalone window.

A service worker needs a secure context: **https or `localhost`**. The phone sees the app as `http://localhost:4170` through an
`adb reverse` tunnel, which satisfies the condition without certificates. The origin owns all data on the device — another port
is another app with separate data.

## 2. Offline cache

**App files.** At build time the plugin lists every file of `dist` (code, fonts, icons, the project packages and their models).
On install the service worker fetches the **whole** list into the cache `home-sim-app-<version>` with `cache: "reload"` —
everything or nothing (a failed install keeps the previous version).

| Request | Rule (`classify`) |
|---|---|
| a file of the version list (incl. `index.html`) | always from the cache of **this** version |
| navigation to an app page (`/` or an extension-less path) | `index.html` of this version |
| `/__api/…` (user document, uploads) | always network — never the cache |
| `/user-assets/…` (imported models and thumbnails) | network + a copy on the device; offline — the device copy (IndexedDB) |
| another origin, a method other than GET | not handled (the browser does it) |
| anything else | network |

## 3. Where data lives

| Data | Place |
|---|---|
| preferences (mode, snapping, quality, electrical layers, door state …) | `localStorage`; project-related keys are suffixed with `:<projectId>` |
| **user document** (interiors, electrical plan, variant thumbnails) | **IndexedDB** `home-simulator` → `project`, one record per project |
| document backups (the last 8 per project) | IndexedDB → `backups` |
| imported GLB / glTF models, their thumbnails | IndexedDB → `assets` (key = the `/user-assets/…` URL) |
| storage schema | IndexedDB → `meta` (`schema: 1`), database version `DB_VERSION = 1` |
| app files | Cache Storage `home-sim-app-<version>` |

Fallback paths: without IndexedDB (private mode) the document goes to `localStorage` (`home-simulator.project.v1:<projectId>`);
when the app is hidden or closed, the last state is also written synchronously to a journal (`home-simulator.project.journal.v1:<projectId>`)
— on start the newer of the records wins. A record of an older storage schema passes through `migrateRecord`; an unreadable record
goes to the backups and does not block the start. Settings → "Protect data" asks the browser for persistent storage (without it
Android may clear site data when space runs low; Chrome usually grants it to an installed app).

## 4. Syncing with the computer

The document has two homes: the **file on the computer** (`userdata/<projectId>/document.json`, endpoint `/__api/document`,
served by the save server in `vite` dev / preview) and the **device** (IndexedDB). Every change writes a working copy on the device
250 ms after the change. "Save" / autosave:

| Situation | What happens | Save button |
|---|---|---|
| connected to the computer | save to the file + device | "Saved" |
| no connection | save on the device, changes wait | "On the device" |
| connection back (`online` event, return to the app, every 30 s) | file unchanged since the last agreement → the device changes go to the file | "Saved" |
| the file changed on the computer **and** the document changed on the device | **conflict**: nothing is overwritten; dialog "Two versions of the project" — keep the version from this device or load the one from the PC; the other goes to the backups | — |
| the file was changed by **another device or tab** while this tab was in sync | the server refuses the save (base version mismatch) → the same conflict and dialog; the change stays on the device | "On the device" |
| the file exists but **cannot be read** (truncated, empty, damaged, rejected by validation) | nothing is written to the file; a dialog with the reason — keep the file (work on the device) or replace it with this device's version (the old file is kept as `…unreadable-<time>`) | "On the device" |
| autosave **off**, change without "Save" | the change stays on the device and **does not** reach the file — neither later nor on return to the app | "Save" |
| the server **rejects** a save (disk error, document > 8 MB) | one error message; the change stays on the device and is retried on the next change, on "Save" or silently every 30 s | "Save" |

Backups: Settings → App and data → "Restore" (an ordinary change — Undo reverts it).

### 4.1 Base version of a save

- Every save carries the header `x-document-base` — a hash of the file version the document was derived from (`none` — the device
  has not seen the file yet; `force` — a deliberate replacement of an unreadable file, the user's decision).
- The server (`saveConfig`) writes only when the file is that version (compared with the hash of the file text, its canonical form
  and its stored form); otherwise it answers `409 { conflict: true }`, and for an unreadable file `409 { conflict: true,
  unreadable: true }`. A save without a base version (an older app) on an existing file is refused with "update the app"; the first
  save of a new file is accepted. A forced replacement keeps the previous file as `…replaced-<time>`.
- A successful save returns the hash of the new version (`base`); the next save of the tab refers to it.
- Saves of one tab run one after another; a save without a server answer ends after 15 s like a lost connection; a finished save
  never rolls back the working copy of a newer change made meanwhile. Checking the file on return to the tab (`refreshFromFile`)
  moves nothing until the file is accepted.
- The device record has an `owed` flag — "saving this content to the file was requested and did not arrive" (offline, refusal).
  The sync loop sends only such content; the flag clears on the next change without a save and on delivery, and survives a restart.

Files added offline (an imported model and its thumbnail) are stored on the device as pending and uploaded to the computer
(`syncAssets`) when the connection returns, before the document changes.

A document belongs to one project: a document of another project is rejected on load and on save.

## 5. Versions and updates

- Version id = hash of the contents of all `dist` files and the service worker code (12 characters; shown in Settings and in
  `dist/pwa-build.json`). A change of any file = a new `sw.js` = a new version.
- Every version has its **own complete** cache; a page always gets the files of its own version — old code never mixes with new
  assets. Activating a version deletes the caches of the others.
- A new version downloads in the background and **waits**. The app shows "a new version is ready" — the switch happens only after
  "Update" / "Save and update": first the document is saved, then the version is activated (`HOME_SIM_SKIP_WAITING`) and the app
  reloads. "Later" postpones it; the app never reloads by itself while the user is working.
- Checks: at start, on returning to the app (at most every 15 min) and with "Check for updates".
- The service worker is enabled in the production build in a secure context. `?pwa=off` disables it and removes the offline cache
  (document data stays); `?pwa=on` enables it. In the dev server (`npm run dev`) and in automated tests it is off by default.

## 6. Acceptance scenario (offline)

Open the project → enter a room → change an item → change a material → add an electrical point → save → restart → the data is
there; then reconnect → the changes reach the document file. Unit tests: `src/pwa/tests/pwa.test.ts` (storage schema, migration,
journal, fallback path, backups, load decision, offline save, sync, conflict, user files, service worker rules, version file list,
manifest), `src/document/tests/model.test.ts`.

## 7. Limitations

- There is no server on the phone: saving to the document file on the computer needs the connection (USB cable + `adb reverse`).
  Without it the document lives on the device and waits.
- One device = one working copy; two phones working offline on the same project meet in a conflict on the first connection
  (manual choice, no merging).
- An update needs a tap on "Update" — also while developing (use `?pwa=off`).
- iOS / Safari are not covered.
