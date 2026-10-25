#!/usr/bin/env node
// Regenerates skills/home-from-plan/references/catalog-ids.md from data/furnitureCatalog.json (npm run skills:catalog).
// --check fails when the committed table is out of date.
import fs from 'node:fs';
const cat = JSON.parse(fs.readFileSync('data/furnitureCatalog.json', 'utf8'));
const OUT = 'skills/home-from-plan/references/catalog-ids.md';
const cats = Object.fromEntries(cat.categories.map((c) => [c.id, c.name]));
const cm = (m) => Math.round(m * 100);
let md = `# Furniture catalog ids\n\nGenerated from \`data/furnitureCatalog.json\` by \`npm run skills:catalog\` — do not edit by hand.\n\n` +
  `Use these ids in \`plan.json → furniture[].catalogId\`. Dimensions are w × d × h in cm (front of the item faces +Y at rot 0; the back is at −d/2).\n` +
  `Placement: **wall** — back against a wall (use \`"wall": "N|S|E|W"\`), **free** — free-standing (use \`"at"\` + \`"rot"\`), **under** — slides under a table, **floor** — rugs.\n` +
  `Wall-mounted items (**mount: wall**) need \`"elevation"\` (height of the bottom edge above the floor, m).\n`;
for (const [cid, cname] of Object.entries(cats)) {
  const items = cat.items.filter((i) => i.category === cid);
  if (!items.length) continue;
  md += `\n## ${cname}\n\n| id | name | w × d × h cm | placement | variants |\n|---|---|---|---|---|\n`;
  for (const i of items) {
    const d = i.dimensions, v = (i.variants ?? []).map((x) => `\`${x.id}\`${x.dimensions ? ` (${Object.entries(x.dimensions).map(([k, val]) => `${k} ${cm(val)}`).join(', ')})` : ''}`).join(', ');
    md += `| \`${i.id}\` | ${i.name} | ${cm(d.w)} × ${cm(d.d)} × ${cm(d.h)} | ${i.placement}${i.mount ? ' · mount: wall' : ''} | ${v || '—'} |\n`;
  }
}
if (process.argv.includes('--check')) { if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== md) { console.error(`${OUT} is out of date — run npm run skills:catalog`); process.exit(1); } }
else { fs.writeFileSync(OUT, md); console.log(`${OUT}: ${cat.items.length} items`); }
