---
name: home-to-phone
description: Install, update or troubleshoot the Home Simulator app on an Android phone over USB (adb + Chrome PWA, no app store). Use when the user says "put it on my phone", "install on Android", "update the app on my phone", "the phone app is old", "the phone can't connect", or plugs in a phone.
allowed-tools: Bash(node scripts/phone/*) Bash(npm run phone*) Bash(npm run build) Read
metadata:
  version: 1
  requires: node>=22.18; an Android phone with Chrome and USB debugging; adb (downloaded by the script if missing)
---

# home-to-phone

The phone runs the same web app, installed from Chrome as a PWA. This computer serves it on **port 4170** over the USB cable
(`adb reverse`); `localhost` is a secure context, so no certificates are needed. The installed app keeps working without the
cable; while the cable is connected and `serve` runs, saves also go to `userdata/<id>/document.json` here. Never change the
port — the app's address is its identity on the phone, and its offline data belongs to it.

## 1. Check

```bash
node scripts/phone/phone.mjs doctor
```
Fix what it reports, in order:
- `adb: not found` → `node scripts/phone/phone.mjs setup-adb` (downloads platform-tools into `.tools/`, no system changes).
- `phone: none connected` → walk the user through the USB-debugging steps the command prints (Build number × 7, Developer
  options, USB debugging, data cable, accept the RSA prompt). Wait for them, then run doctor again.
- `unauthorized` → unlock the phone and accept "Allow USB debugging?".
- `port 4170` in use → stop the other server (`vite preview`, an earlier `serve`).

## 2. Install (first time)

```bash
node scripts/phone/phone.mjs serve [--project <id>]
```
Keeps running (run it in the background in agent sessions). It builds, serves, tunnels and opens the app in Chrome on the
phone. Then tell the user: wait for "Offline mode: ready" (Settings → App & data), Chrome menu ⋮ → **Install app**. Check:
```bash
node scripts/phone/phone.mjs verify        # standalone: true once installed; offline ready; build id
```

## 3. Update (after changes)

Stop the old `serve`, start it again (it rebuilds), then with the app open on the phone:
```bash
node scripts/phone/phone.mjs update        # build A → build B
```
Without the cable: the user opens the app while `serve` runs, Settings → "Check for update" → "Update".

## 4. Troubleshooting

`references/troubleshooting.md`. Reset the offline copy: `node scripts/phone/phone.mjs reset --confirm` (projects saved on the
phone stay until the user clears the site data in Chrome).

iOS is not supported by this flow (no adb); an iPhone can open the app on the same Wi-Fi with HTTPS — out of scope here.
