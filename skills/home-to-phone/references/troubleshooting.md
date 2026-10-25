# Phone troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `adb devices` shows nothing | charge-only cable, USB mode, driver (Windows) | data cable; pull down notifications → USB → "File transfer"; Windows: install the OEM USB driver |
| `unauthorized` | RSA prompt not accepted | unlock the phone, accept, tick "Always allow" |
| `offline` | stale connection | unplug / plug, `adb kill-server`, run doctor |
| Chrome opens but "This site can't be reached" | the tunnel is gone (cable re-plugged) or serve stopped | run `serve` again (it re-creates `adb reverse`) |
| "Install app" missing in the menu | the page was opened via the PC's IP or another port | it must be `http://localhost:4170/` — only localhost is a secure context without certificates |
| App installed, shows an old version | a new build was not activated | `serve` with the new build + `update`, or Settings → Check for update → Update |
| Two apps with different data | the app was once opened on another port | ports are different apps for the phone — always use 4170; remove the other icon |
| Saves stay "on the device" | the cable is not connected or serve does not run | connect + serve; the app syncs pending changes; on conflict it asks which version to keep |
| Very slow / hot phone | high quality profile | Settings → Graphics quality → Balanced or Low; "Save battery" |
