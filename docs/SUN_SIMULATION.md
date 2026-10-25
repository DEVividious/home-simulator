# Sun simulation and shadows

The direction, elevation and colour of the sun follow from **the geographic position of the project, the date and time, and
the orientation of the building**. Shadows, sky light and interiors react to these values live. The building geometry never
changes.

## 1. Input data

Sun data is an optional module of the project package (`sun`, ADR 0007, ADR 0011). In `plan.json`:

```json
"sun": { "lat": 50.0, "lon": 8.0, "timeZone": "Europe/Berlin", "northAzimuthX": 90,
         "confidence": "probable", "placeName": "Example town" }
```

The compiler (`src/authoring/compile.ts`) validates the time zone (`Intl`) and writes `project().sun` (`SunSite`,
`src/home/model/sun.ts`):

| Field | Meaning |
|---|---|
| `lat`, `lon` | latitude and longitude [°] |
| `gridAzimuthX`, `convergence` | azimuth of the project +X axis from grid north and the meridian convergence [°] (when the source is a projected map) |
| `trueAzimuthX` | **geographic** azimuth of the +X axis, clockwise from north = grid + convergence (90 = +X points east) |
| `confidence`, `uncertaintyDeg` | orientation confidence; `confirmed` removes the "Approximate north" badge (compiled: ±2° confirmed, ±15° otherwise) |
| `timeZone` | IANA time zone, e.g. `Europe/Berlin`, `America/New_York` |
| `placeName` | place name shown in the sun panel |

Directions in LCS: `northEastLcs(trueAzimuthX)` gives north = `(cos A, sin A)` and east = `(sin A, −cos A)`.

**A project without sun data** (e.g. an apartment with no position): the scene is still lit by a simulated sun, from
`unknownSite()` — the **device's time zone**, a longitude matching its current UTC offset (`offset in minutes / 4`), latitude
50°, +Y = north, confidence `assumed`. The sun panel, the stored time of day of variants and the sun line in screenshots exist
only in projects with the `sun` module.

**Date and time:** today at 14:00 by default; `?date=YYYY-MM-DD&time=HH:MM` override (only with the `sun` module).

## 2. Sun position — `src/home/model/sun.ts`

- **NOAA algorithm** (Meeus): equation of time, declination, hour angle, azimuth (from north, clockwise) and elevation with
  atmospheric refraction correction. Accuracy about 0.01° for 1900–2100 — far better than a typical orientation uncertainty.
- **Local time**: any IANA time zone via `Intl` (`tzOffsetMinutes`, `localToUtc`, `zoneLabel` → "UTC+02:00"); daylight saving
  rules come from the platform's time zone database. `localToUtc` iterates twice so the offset is right next to a DST switch.
- **Sunrise and sunset** (`sunTimes`): disc centre at −0.833° (refraction + disc radius), found by bisection. **Solar noon**:
  maximum elevation (10 min search + refinement).
- **Direction in LCS**: `sunDirLcs(az, el) = cos(el)·(sin(az)·E + cos(az)·N) + sin(el)·Z`.
- **Times of day** (`sunPresets`, rounded to 5 min): Morning — halfway from sunrise to solar noon; Noon — solar noon;
  Afternoon — halfway from solar noon to sunset; Sunset — 15 min before sunset (sun about 1–2° above the horizon, light and
  shadows still visible).

Unit tests (`src/home/tests/sun.test.ts`) check the algorithm against reference values: elevation at solar noon on the equinox
= 90° − latitude, sunrise / sunset times, DST transitions in several zones.

## 3. User interface

Two elements in the top-right corner of the scene (projects with the `sun` module):

**1. Sun button** (current time and date) opens the panel:

| Element | Behaviour |
|---|---|
| **Date** | date field |
| **Time** | time field (5 min steps) |
| **24-hour dial** | laid out like the sun's path: **12:00 at the top**, 6:00 left (east), 18:00 right (west), 0:00 at the bottom. A yellow day arc from sunrise to sunset for the selected date, dark night, ticks at sunrise and sunset. **Dragging the sun** (at night the moon) around the dial sets the time in 5 min steps; wheel and arrow keys on the focused dial: ±5 min, with Shift ±1 h. Time and date in the centre; shadows update live |
| **Morning / Noon / Afternoon / Sunset** | the presets of section 2 |

The panel also shows the sun azimuth and elevation, sunrise, solar noon and sunset with the zone offset, and the place name.
On a phone the panel is a low strip with a 0–24 h day bar instead of the dial ([MOBILE_UX.md](MOBILE_UX.md)).

**2. North arrow.** It rotates with the camera and points to north on screen. When the orientation is not confirmed
(`confidence ≠ confirmed`) it carries an **"Approximate north"** badge with the confidence and the uncertainty (±°).

**State:** date and time are view state, not part of the document; they enter a variant only through "Save"
([VARIANTS_AND_ARRANGEMENTS.md](VARIANTS_AND_ARRANGEMENTS.md)). Whether the panel is expanded is remembered locally.

## 4. Light and shadows — `src/home/scene/Lighting.tsx`

**Sun light.** One directional light in the sun direction:

- **colour** from orange near the horizon (golden hour) to white from about 22° elevation;
- **intensity** faded near the horizon, full from about 30° elevation;
- **below the horizon**: no direct light and **no shadows** (the shadow map is not updated).

**Sky.** A zenith → horizon gradient by sun elevation (day, golden hour, dusk, night) with a glow around the disc; fog and
background take the horizon colour. ACES tone mapping.

**Evening and night** — night should be night, but readable:

| Element | At night |
|---|---|
| sky | dark blue (`#16233d` → `#3a4866`), not black — silhouettes stand out against it |
| sky light (hemisphere) | raised and cool |
| moonlight | directional light 0.55, cool, **no shadows** |
| IBL | at least 35% |
| windows seen from outside | glow warmly (emissive glass up to 0.45) |
| interiors (section, room, walk) | warm artificial light: warmer hemisphere, stronger top light under the section, a stronger walk lamp |

**IBL** (environment map from the sky with the sun): PMREM 256 px (smaller in mobile profiles), recomputed **once a time change
has settled** (220 ms), not on every slider move; intensity scaled by the amount of daylight, at least 35% at night.

**Shadows:**

- one shadow map: **2048 px** (PCF soft) / **1024 px** (PCF) / none — per quality profile
  ([PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md));
- **no cascades** and no shadows from point lights;
- shadow camera fitted to the mode:

| Mode | Range | Density at 2048 px |
|---|---|---|
| exterior view, walk | ±26 m (building and the nearest plot) or more for a larger building | about 2.5 cm / texel |
| level section, room | ±13 m (building only) | about 1.3 cm / texel |

- the shadow map is **updated only on change** (`shadowMap.autoUpdate = false`): time or date, mode or project change, a
  furniture drag, and additionally every 2 s (while models load). It is never updated per frame — the shadow camera does not
  depend on the view camera.

## 5. Interiors: light through windows

The simulation works in every mode: building view, level section, room 3D, room walk and building walk. Sunlight passes
through glass because **glass casts no shadows**; walls, roof, slabs and furniture do.

- **Section and cutaway do not break the light.** The level section hides the roof and slab only in the image: materials have
  `clipShadows = false`, so the roof still casts its shadow in the shadow map. The Room Mode wall cutaway behaves the same way —
  the shadow map uses the full geometry.
- **Less uniform light indoors**, so that sun patches on the floor are readable: a weak top light under the section by day
  (stronger and warmer at night), a moderate hemisphere, IBL 0.45 in section and room, 0.5 in the room walk.

## 6. Performance rules

- one shadow map ≤ 2048 px, PCF, no cascades;
- shadow map updated only on change; no shadows at night;
- IBL recomputed after the change settles;
- no extra passes (no SSAO, no volumetrics); helper lights cast no shadows.

The cost of the time slider is one shadow map update per change.

## 7. Limitations

- The orientation is only as good as its source — hence the "Approximate north" badge until it is confirmed (setting survey
  data or a georeferenced plan; then `confidence: "confirmed"` in `plan.json`).
- Terrain and horizon (forest, hills) **do not block the sun in the computation**; trees of the surroundings cast no shadows.
  Sunrise and sunset are computed for the mathematical horizon.
- **No** light bounces between surfaces (global illumination) and no clouds.

## Files

- Model: `src/home/model/sun.ts`.
- Scene: `src/home/scene/Lighting.tsx` (light, sky, IBL, shadows), `src/home/scene/HomeCanvas.tsx` (background / fog).
- UI: `src/home/ui/SunPanel.tsx`. State: `src/home/store/ui.ts` (`sun`, `sunPanel`).
- Tests: `src/home/tests/sun.test.ts`.
