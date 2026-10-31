# Importing a plan image

For estate-agent plans, scans, screenshots, photos of drawings, or PDF pages without vector content
(`tools/pdf/render.py plan.pdf --out page.png` first).

1. `tools/image/prepare.py PLAN --out DIR` — `grid.png` (labelled pixel grid; minor 50 px, labelled 100 px), four 2× tiles,
   `info.json`. `--crop`, `--rotate` for rotated or cluttered sheets (labels stay in the coordinates of the processed image).
   `--zoom-box x0,y0,x1,y1` (repeatable) writes 4× close-ups with a 10 px grid — needed on small images, where walls are only a
   few pixels thick.
2. Read the drawing: rooms (inner faces), doors (opening centre, the room the arc is in = `swingInto`, the arc centre = hinge
   side), windows (point on the wall, width), fixtures (skills/home-from-plan/references/symbol-legend.md).
3. Scale with `tools/image/calibrate.py --file DIR/../calibration.json`:
   `points --a … --b … --length …` (dimension chain, scale bar — best when printed), `area --rect … --m2 …` (printed room
   area; often 2–5 % below length × width), `total --rects "…;…" --m2 …` (rooms vs total area), `symbol --kind
   door|entrance-door|bathtub|bed|wc …` (weak priors, ignored when anything measured exists). `summary --origin X,Y [--use …]`
   reports the agreement and prints the `calibration` block. Two measured estimates within 5 %, or ask for one dimension. A plan
   without any printed number: three symbol estimates of two kinds within 5 % give a PROBABLE scale — say so and ask for one
   dimension.
4. `plan.json` with `"units": "px"`: points in pixels, sizes in metres. The compiler flips y, converts, snaps to 5 mm, aligns faces
   (4 cm) and sets shared walls close to the interior thickness to exactly that thickness (`regularize`), reporting every change.
5. Build, preview, compare, iterate (docs/AUTHORING.md).

Typical accuracy: ±1–3 % on room sizes when the scale comes from printed areas; door and window positions to ~5 cm.
