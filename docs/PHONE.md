# The app on an Android phone

The phone runs the same web app installed as a PWA from Chrome. This computer serves it over USB; no app store, no APK, no
certificates (ADR 0018). Agents: the `home-to-phone` skill.

```bash
node scripts/phone/phone.mjs doctor       # adb, phone, authorisation, Chrome, port, build
node scripts/phone/phone.mjs setup-adb    # downloads Android platform-tools into .tools/ if adb is missing
node scripts/phone/phone.mjs serve        # build → vite preview on 4170 → adb reverse → opens Chrome on the phone (keeps running)
node scripts/phone/phone.mjs verify       # installed? offline ready? which build?
node scripts/phone/phone.mjs update       # with serve running a new build: update the installed app
node scripts/phone/phone.mjs reset --confirm
```

First install: in Chrome on the phone wait for "Offline mode: ready" (Settings → App & data), then ⋮ → **Install app**.

- **Port 4170 is fixed.** The phone treats `localhost:4170` as the app; another port is another app with separate data.
- **Saving**: always on the phone (IndexedDB, with backups); while the cable is connected and `serve` runs, also into
  `userdata/<id>/document.json` on the computer. Edits made in both places → the app shows a conflict and asks which to keep.
- **Phone setup**: Settings → About phone → tap Build number 7× → Developer options → USB debugging; data cable; accept the RSA
  prompt.
- iOS is not covered (no adb).
