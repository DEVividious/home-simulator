// PROJECT BOUNDARY: package validation (readable schema and semantic errors), the project index built from disk, the registry
// (choice of the project, storage keys, files), isolation of user state between projects (device storage, document, save
// server file, variant files) and the save server's protection against silent data loss.
import 'fake-indexeddb/auto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVariant, defaultDoc, docErrors, serializeDoc, type ConfiguratorDoc } from '../../document/model';
import { BASE_HEADER, configApiMiddleware, configFile, loadConfig, saveConfig } from '../../document/server';
import { exportVariant, importVariant } from '../../home/model/variantData';
import { sections } from '../../home/store/ui';
import { closeDb, DB_NAME } from '../../storage/db';
import { addBackup, FALLBACK_LS_KEY, hashText, listBackups, readProject, STORAGE_SCHEMA, writeProject } from '../../storage/project';
import { activateProject, derived, derivedByKey, hasCapability, hasModule, project, projectId, withProject } from '../active';
import { buildProjectIndex, projectDirs, readProjectDir } from '../node';
import {
  assetUrl, engineCatalogIds, loadProject, loadProjectIndex, packageErrors, projectEntry, projectFile, projectIds, projectIndex, resolveProjectId,
  scopedKey, setProjectIndex, switchProject, type ProjectIndex,
} from '../registry';
import { ProjectIndexSchema, schemaErrors } from '../schema';
import type { ProjectPackage } from '../types';
import { validateProject } from '../validate';

const root = path.resolve(__dirname, '..', '..', '..');
const demo = readProjectDir(join(root, 'projects', 'demo-apartment'));
const house = readProjectDir(join(root, 'projects', 'sample-house'));
const catalogIds = engineCatalogIds();
const clone = (p: ProjectPackage): ProjectPackage => structuredClone(p);
const errorsOf = (p: unknown, id = 'demo-apartment') => packageErrors(p, id, catalogIds);
const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), `home-sim-${prefix}-`));

describe('package validation', () => {
  it('both shipped packages are valid (also against the furniture catalog)', () => {
    expect(errorsOf(demo)).toEqual([]);
    expect(errorsOf(house, 'sample-house')).toEqual([]);
    expect(validateProject(demo, catalogIds)).toEqual([]);
    expect(validateProject(house, catalogIds)).toEqual([]);
  });

  it('schema errors are readable: "path: message", the semantic check is skipped until the structure is valid', () => {
    const p = clone(demo) as unknown as Record<string, any>;
    delete p.manifest.name;
    p.manifest.units = 'cm';
    p.manifest.projectId = 'Demo_Flat';
    p.building.rooms.rooms[0].polygon = [[0, 0]];
    p.building.doors[0].type = 'revolving';
    p.building.rooms.rooms[1].level = 'L9';                        // a semantic error — not reported while the structure is broken
    p.extra = true;
    expect(errorsOf(p)).toEqual([
      'manifest.projectId: lower-case letters, digits and hyphens',
      'manifest.name: Invalid input: expected string, received undefined',
      'manifest.units: Invalid input: expected "m"',
      'building.rooms.rooms.0.polygon: Too small: expected array to have >=3 items',
      'building.doors.0.type: Invalid option: expected one of "hinged-single"|"hinged-double"|"sliding"|"pocket"',
      '(root): Unrecognized key: "extra"',
    ]);
    expect(errorsOf('not a package')).toEqual(['(root): Invalid input: expected object, received string']);
    expect(errorsOf({ ...clone(demo), version: 2 }).join(' ')).toMatch(/^version: /);
  });

  it('id in the package must match the id in the project index (the directory name)', () => {
    expect(errorsOf(demo, 'demo-apartment')).toEqual([]);
    expect(errorsOf(demo, 'other-flat')).toEqual(['manifest.projectId "demo-apartment" ≠ id in the project index "other-flat"']);
  });

  it('cross references: unknown level, room, door, furniture room, catalog item, electrical room', () => {
    const p = clone(demo);
    p.manifest.defaultView = { levelId: 'L9', roomId: 'R42' };
    p.building.rooms.rooms[0].level = 'L2';
    p.building.doors.push({ ...p.building.doors[1], id: 'DX', rooms: ['R4', 'R99'] });
    p.building.doors.push({ ...p.building.doors[1], id: 'DY', level: 'L7' });
    p.building.rooms.rooms[1].doors = [{ ...p.building.rooms.rooms[1].doors[0], door_id: 'D-NONE' }];
    p.interiors.items.push({ ...p.interiors.items[0], key: 'stray', room: 'R77', catalogId: 'no-such-item' });
    p.electrical.points.push({ ...p.electrical.points[0], id: 'P-X', roomId: 'R55' });
    const e = validateProject(p, catalogIds);
    expect(e).toEqual(expect.arrayContaining([
      'manifest.defaultView: unknown level "L9"',
      'manifest.defaultView: unknown room "R42"',
      'room "R1": unknown level "L2"',
      'door "DX": unknown room "R99"',
      'door "DY": unknown level "L7"',
      'room "R2": door gap points to unknown door "D-NONE"',
      'furniture "stray": unknown room "R77"',
      'furniture "stray": unknown catalog item "no-such-item"',
      'electrical point "P-X": unknown room "R55"',
    ]));
    // a door to the outside is not an unknown room
    expect(e.join('\n')).not.toMatch(/unknown room "exterior"/);
  });

  it('repeated ids of rooms, doors, furniture and electrical points', () => {
    const p = clone(demo);
    p.building.rooms.rooms.push({ ...p.building.rooms.rooms[3] });
    p.building.doors.push({ ...p.building.doors[0] });
    p.interiors.items.push({ ...p.interiors.items[0] });
    p.electrical.points.push({ ...p.electrical.points[0] });
    expect(validateProject(p)).toEqual(expect.arrayContaining(['room "R4": repeated id', 'door "D0": repeated id', `furniture "${p.interiors.items[0].key}": repeated key`, `electrical point "${p.electrical.points[0].id}": repeated id`]));
  });

  it('manifest ↔ room data: levels must match, every level needs a room', () => {
    const p = clone(demo);
    p.manifest.levels = [...p.manifest.levels, { id: 'L2', name: 'Mezzanine', floorZ: 2.85 }];
    expect(validateProject(p)).toEqual(['manifest.levels: level "L2" is missing from building.rooms.levels']);
    p.building.rooms.levels.L2 = { name: 'Mezzanine', floor_z: 2.85 };
    expect(validateProject(p)).toEqual(['level "L2": no rooms (every level needs at least one)']);
    p.building.rooms.levels.L2.floor_z = 3;
    expect(validateProject(p)).toContain('manifest.levels: level "L2" has a different floor (2.85) than the room data (3)');
  });

  it('roof: parts on known levels, dormers on known parts, a ceiling under the roof only on a level with a part', () => {
    const p = clone(house), roof = p.building.roof!;
    expect(validateProject(p)).toEqual([]);
    roof.parts.push({ ...roof.parts[0], id: 'wing', level: 'L9' }, { ...roof.parts[0], id: 'wing2', rect: undefined, type: 'hip' });
    roof.dormers = [{ id: 'DD', part: 'nope', type: 'gable', front: 'S', rect: [1, 0, 3, 2], inner: [1.2, 0.3, 2.8, 2], extent: [0.8, -0.2, 3.2, 2], planes: roof.parts[0].planes, window: { id: 'W99', roomId: 'X1', width: 1, sill_z: 4, head_z: 5 } }];
    p.building.rooms.rooms[0].ceiling = { kind: 'roof', flat_z: 2.7 };
    expect(validateProject(p)).toEqual([
      'roof part "wing": unknown level "L9"', 'roof part "wing2": a hip part needs a rect (a polygon is for flat parts only)',
      'dormer "DD": unknown roof part "nope"', 'dormer "DD": window in unknown room "X1"',
      `room "${p.building.rooms.rooms[0].id}": its ceiling is under the roof but level "L0" has no roof part`,
    ]);
  });

  it('module enabled in the manifest without its data — error naming the missing data', () => {
    const p = clone(demo);
    p.manifest.modules = ['site', 'environment', 'sun', 'stairs'];
    expect(validateProject(p)).toEqual([
      'module "site" requires the building and plot outline (site)',
      'module "environment" requires a surroundings model (assets.environment)',
      'module "sun" requires geographic position, orientation and time zone (sun)',
      'module "stairs" requires stairs (building.stairs)',
    ]);
    const h = clone(house);
    delete h.sun;
    h.building.stairs = [];
    expect(validateProject(h)).toEqual(['module "sun" requires geographic position, orientation and time zone (sun)', 'module "stairs" requires stairs (building.stairs)']);
    p.manifest.modules = ['stairs', 'stairs'] as never;
    expect(validateProject(p)).toContain('manifest.modules: repeated module');
  });

  it('views: a preset without a direction or a camera pose, reserved and repeated ids, unknown home view', () => {
    const p = clone(demo);
    const view = (id: string, extra: object = { dir: [1, -1, 0.5] }) => ({ id, label: id, icon: 'eye', hint: '', ...extra });
    p.views = { presets: [view('front'), view('nowhere', {}), view('interior'), view('front')], home: 'aerial' };
    expect(validateProject(p)).toEqual([
      'views.presets: repeated id',
      'views.presets: id "interior" is reserved',
      'views.home: unknown view "aerial"',
      'view "nowhere": needs a direction (dir) or a camera pose (pose)',
    ]);
    p.views = { presets: [view('front'), view('posed', { pose: { position: [1, 2, 3], target: [0, 0, 0], fov: 50 } })], home: 'posed' };
    expect(validateProject(p)).toEqual([]);
    p.views = { presets: [] };
    expect(validateProject(p)).toEqual(['views.presets: empty list (omit the field to use the default views)']);
  });

  it('reserved ids: rooms EXT / exterior, level SITE; viewpoints on the site level need a site', () => {
    const p = clone(demo);
    p.building.rooms.rooms[2].id = 'EXT';
    p.building.rooms.rooms[3].id = 'exterior';
    expect(validateProject(p)).toEqual(expect.arrayContaining(['room "EXT": id reserved by the engine (exterior space)', 'room "exterior": id reserved by the engine (exterior space)']));
    const s = clone(demo);
    s.manifest.levels = [{ id: 'SITE', name: 'Site', floorZ: 0 }];
    s.building.rooms.levels = { SITE: { name: 'Site', floor_z: 0 } };
    s.manifest.defaultView = { levelId: 'SITE' };
    for (const r of s.building.rooms.rooms) r.level = 'SITE';
    for (const d of s.building.doors) d.level = 'SITE';
    expect(validateProject(s)).toContain('level "SITE": id reserved by the engine (site plan)');
    const v = clone(demo);
    v.viewpoints = [{ ...v.viewpoints![0], level: 'SITE' }];
    expect(validateProject(v)).toEqual([`viewpoint "${v.viewpoints[0].id}": the project has no site`]);
  });

  it('a project without a building model file needs an orthogonal plan (generated shell); with a model a slanted wall is allowed', () => {
    const p = clone(demo);
    p.building.rooms.rooms[0].polygon = [[2.52, 0.3], [8.7, 0.3], [8.0, 3.9], [2.52, 3.9]];   // slanted east wall
    expect(validateProject(p)).toEqual(['a project without a building model file (assets.model) needs orthogonal room outlines — the generated shell does not support slanted walls']);
    expect(validateProject({ ...p, assets: { model: 'model/building.glb' } })).toEqual([]);
  });

  it('unknown capability is a package error; capabilities drive the UI steps (Electrical and Expert only in advanced mode)', () => {
    const ids = (p: ProjectPackage, mode: 'simple' | 'advanced' = 'simple') => withProject(p, () => sections(mode).map((x) => x.id));
    expect(ids(demo)).toEqual(['look', 'arrange', 'variants']);
    expect(ids(house)).toEqual(['look', 'arrange', 'variants']);
    expect(ids(house, 'advanced')).toEqual(['look', 'arrange', 'variants', 'electrical', 'expert']);
    const p = clone(demo);
    p.manifest.capabilities = ['interiors', 'walk'];
    expect(ids(p)).toEqual(['look', 'arrange']);
    expect(ids(p, 'advanced')).toEqual(['look', 'arrange', 'expert']);
    expect(withProject(p, () => [hasCapability('electrical'), hasCapability('walk')])).toEqual([false, true]);
    expect(withProject(p, () => sections()[0].label)).toBe(withProject(demo, () => sections()[0].label));
    p.manifest.capabilities = ['interiors', 'teleport' as never];
    expect(validateProject(p)).toEqual(['manifest.capabilities: unknown capability "teleport"']);
  });
});

describe('project directories and the project index', () => {
  const env = process.env.HOME_SIM_DEFAULT_PROJECT;
  let dir = '';
  beforeEach(() => { dir = tmp('index'); delete process.env.HOME_SIM_DEFAULT_PROJECT; });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); if (env === undefined) delete process.env.HOME_SIM_DEFAULT_PROJECT; else process.env.HOME_SIM_DEFAULT_PROJECT = env; });
  const put = (id: string, content: string | object | null) => {
    mkdirSync(join(dir, 'projects', id), { recursive: true });
    if (content !== null) writeFileSync(join(dir, 'projects', id, 'project.json'), typeof content === 'string' ? content : JSON.stringify(content));
  };

  it('index from a directory: only directories with project.json, sorted; name and description from the manifest', () => {
    put('demo-apartment', demo);
    put('zeta-house', { manifest: { name: 'Zeta house', description: 'two storeys' } });
    put('broken', '{ not json');
    put('no-package', null);
    writeFileSync(join(dir, 'projects', 'notes.txt'), 'not a project');
    expect(projectDirs(dir)).toEqual(['broken', 'demo-apartment', 'zeta-house']);
    const i = buildProjectIndex(dir);
    expect(i).toEqual({
      schema: 'home-simulator/projects-index', version: 1, default: 'broken',
      projects: [
        { id: 'broken', name: 'broken', dir: 'projects/broken/' },                // unreadable package: listed, reported at load time
        { id: 'demo-apartment', name: 'Demo apartment', names: demo.manifest.names, description: 'example project · synthetic data', dir: 'projects/demo-apartment/' },
        { id: 'zeta-house', name: 'Zeta house', description: 'two storeys', dir: 'projects/zeta-house/' },
      ],
    });
    expect(schemaErrors(ProjectIndexSchema, i)).toEqual([]);
  });

  it('default project: HOME_SIM_DEFAULT_PROJECT (when installed) → the user\'s first project → sample-house → the demo', () => {
    put('demo-apartment', demo);
    expect(buildProjectIndex(dir).default).toBe('demo-apartment');
    put('sample-house', { manifest: { name: 'Sample house' } });
    expect(buildProjectIndex(dir).default).toBe('sample-house');
    put('zeta-house', { manifest: { name: 'Zeta' } });
    expect(buildProjectIndex(dir).default).toBe('zeta-house');          // sorts after the examples, still opens first
    put('my-flat', { manifest: { name: 'My flat' } });
    expect(buildProjectIndex(dir).default).toBe('my-flat');
    process.env.HOME_SIM_DEFAULT_PROJECT = 'zeta-house';
    expect(buildProjectIndex(dir).default).toBe('zeta-house');
    process.env.HOME_SIM_DEFAULT_PROJECT = 'not-installed';
    expect(buildProjectIndex(dir).default).toBe('my-flat');
  });

  it('no projects directory: empty index', () => {
    expect(projectDirs(dir)).toEqual([]);
    expect(buildProjectIndex(dir)).toMatchObject({ default: 'demo-apartment', projects: [] });
  });

  it('the shipped repository: both packages are listed', () => {
    expect(buildProjectIndex(root).projects.map((p) => p.id)).toEqual(expect.arrayContaining(['demo-apartment', 'sample-house']));
  });

  it('readProjectDir: the directory name is the project id — a copied package under another name is rejected', () => {
    put('my-flat', demo);
    expect(() => readProjectDir(join(dir, 'projects', 'my-flat'))).toThrow(/manifest\.projectId "demo-apartment" ≠ id in the project index "my-flat"/);
    put('demo-apartment', demo);
    expect(readProjectDir(join(dir, 'projects', 'demo-apartment')).manifest.projectId).toBe('demo-apartment');
    const bad = clone(demo);
    bad.building.rooms.rooms[0].level = 'L5';
    put('demo-apartment', bad);
    expect(() => readProjectDir(join(dir, 'projects', 'demo-apartment'))).toThrow(/is invalid:\n {2}room "R1": unknown level "L5"/);
  });
});

describe('active project and derived values', () => {
  it('derived computes once per package; withProject switches the package only for the call (also on an exception)', () => {
    let builds = 0;
    const name = derived((p) => { builds++; return p.manifest.name; });
    const perRoom = derivedByKey((id: string, p) => `${p.manifest.projectId}:${id}`);
    expect(projectId()).toBe('demo-apartment');                         // the default of unit tests (src/test/setup.ts)
    const active = project();
    expect(name()).toBe('Demo apartment'); name();
    expect(withProject(house, () => [name(), name(), perRoom('H0'), hasModule('site')])).toEqual(['Sample house', 'Sample house', 'sample-house:H0', true]);
    expect(builds).toBe(2);
    expect(project()).toBe(active);
    expect(perRoom('R1')).toBe('demo-apartment:R1');
    expect(hasModule('site')).toBe(false);
    expect(() => withProject(house, () => { throw new Error('x'); })).toThrow('x');
    expect(project()).toBe(active);
  });
});

describe('registry: choosing the project, storage keys, files', () => {
  const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown };
  const shipped = projectIndex();
  const INDEX: ProjectIndex = {
    schema: 'home-simulator/projects-index', version: 1, default: 'demo-apartment',
    projects: [{ id: 'demo-apartment', name: 'Demo apartment', dir: 'projects/demo-apartment/' }, { id: 'sample-house', name: 'Sample house', dir: 'projects/sample-house/' }],
  };
  beforeEach(() => setProjectIndex(INDEX));
  afterEach(() => { delete g.localStorage; delete g.sessionStorage; vi.unstubAllGlobals(); setProjectIndex(shipped); activateProject(demo); });

  it('index lookups', () => {
    expect(projectIds()).toEqual(['demo-apartment', 'sample-house']);
    expect(projectEntry('sample-house')?.name).toBe('Sample house');
    expect(projectEntry('nope')).toBeNull();
  });

  it('?project=<id> → project of this tab → last chosen on the device → default; unknown ids are ignored', () => {
    expect(resolveProjectId('')).toBe('demo-apartment');
    expect(resolveProjectId('?project=sample-house')).toBe('sample-house');
    expect(resolveProjectId('?project=deleted-project')).toBe('demo-apartment');
    g.localStorage = { getItem: (k: string) => (k === 'home-simulator.project' ? 'sample-house' : null) };
    expect(resolveProjectId('')).toBe('sample-house');
    expect(resolveProjectId('?project=demo-apartment')).toBe('demo-apartment');
    g.localStorage = { getItem: () => 'deleted-project' };
    expect(resolveProjectId('')).toBe('demo-apartment');
    // the tab remembers its project: a link without the parameter stays in the tab's project even when another tab chose a
    // different project on the device later
    g.localStorage = { getItem: () => 'sample-house' };
    g.sessionStorage = { getItem: () => 'demo-apartment' };
    expect(resolveProjectId('')).toBe('demo-apartment');
    expect(resolveProjectId('?project=sample-house')).toBe('sample-house');
    g.sessionStorage = { getItem: () => 'deleted-project' };
    expect(resolveProjectId('')).toBe('sample-house');
    // storage without access (private mode) — the default
    g.localStorage = { getItem: () => { throw new Error('denied'); } };
    g.sessionStorage = undefined;
    expect(resolveProjectId('')).toBe('demo-apartment');
  });

  it('every project — including the first one — has its own storage keys and its own document file', () => {
    expect(scopedKey('home-simulator.doors', 'demo-apartment')).toBe('home-simulator.doors:demo-apartment');
    expect(scopedKey('home-simulator.doors', 'sample-house')).toBe('home-simulator.doors:sample-house');
    expect(scopedKey('k')).toBe('k:demo-apartment');
    expect(withProject(house, () => scopedKey('k'))).toBe('k:sample-house');
    expect(projectFile('demo-apartment')).toBe('demo-apartment/document.json');
    expect(projectFile('sample-house')).toBe('sample-house/document.json');
  });

  it('asset URLs: relative to the project directory; absolute and external URLs are kept', () => {
    expect(assetUrl('model/site.glb')).toBe('/projects/demo-apartment/model/site.glb');
    expect(assetUrl('model/site.glb', 'sample-house')).toBe('/projects/sample-house/model/site.glb');
    expect(assetUrl('/user-assets/a.glb')).toBe('/user-assets/a.glb');
    expect(assetUrl('https://cdn.example/x.glb')).toBe('https://cdn.example/x.glb');
    expect(assetUrl('x.glb', 'not-indexed')).toBe('/projects/not-indexed/x.glb');
  });

  it('switching to an unknown project throws; without an index the registry says what is missing', () => {
    expect(() => switchProject('nope')).toThrow(/Unknown project "nope"/);
    setProjectIndex(null as never);
    expect(() => projectIds()).toThrow(/No project index/);
  });

  it('loading: index and package come from the server, are validated and the package is activated', async () => {
    setProjectIndex(null as never);
    const files: Record<string, unknown> = { '/projects/index.json': INDEX, '/projects/sample-house/project.json': house, '/projects/demo-apartment/project.json': { ...clone(demo), manifest: { ...demo.manifest, levels: [] } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url in files ? new Response(JSON.stringify(files[url]), { status: 200 }) : new Response('', { status: 404 }))));
    expect((await loadProjectIndex()).default).toBe('demo-apartment');
    expect((await loadProject('sample-house')).manifest.projectId).toBe('sample-house');
    expect(projectId()).toBe('sample-house');
    await expect(loadProject('demo-apartment')).rejects.toThrow(/Project package "demo-apartment" is invalid: manifest\.levels: Too small/);
    await expect(loadProject('nope')).rejects.toThrow(/Unknown project "nope" \(available: demo-apartment, sample-house\)/);
  });

  it('loading: an invalid or empty index is reported', async () => {
    setProjectIndex(null as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schema: 'x' }), { status: 200 })));
    await expect(loadProjectIndex()).rejects.toThrow(/projects\/index\.json is invalid/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...INDEX, projects: [] }), { status: 200 })));
    await expect(loadProjectIndex()).rejects.toThrow(/No projects installed/);
    setProjectIndex(null as never);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(loadProjectIndex()).rejects.toThrow(/HTTP 404/);
  });
});

describe('device storage: every project has its own record, fallback keys and backups', () => {
  const mem = new Map<string, string>();
  const fakeLs = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 } as Storage;
  const rec = (text: string) => ({ schema: STORAGE_SCHEMA, text, rev: 1, savedAt: '2026-10-04T10:00:00.000Z', pending: true, baseHash: null });
  beforeEach(async () => {
    vi.stubGlobal('localStorage', fakeLs);
    await closeDb(); await new Promise((ok) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => ok(null); }); mem.clear();
  });
  afterEach(async () => { await closeDb(); vi.unstubAllGlobals(); activateProject(demo); });

  it('IndexedDB: the record of one project is not visible in another', async () => {
    activateProject(demo);
    expect(await writeProject(rec('demo text'))).toBe('indexeddb');
    activateProject(house);
    expect((await readProject()).project).toBeNull();
    expect(await writeProject(rec('house text'))).toBe('indexeddb');
    activateProject(demo);
    expect((await readProject()).project!.text).toBe('demo text');
    activateProject(house);
    expect((await readProject()).project!.text).toBe('house text');
  });

  it('fallback without IndexedDB: localStorage keys carry the project id', async () => {
    await closeDb();
    vi.stubGlobal('indexedDB', undefined);
    activateProject(demo);
    expect(await writeProject(rec('demo text'))).toBe('fallback');
    expect([...mem.keys()]).toEqual([`${FALLBACK_LS_KEY}:demo-apartment`]);
    activateProject(house);
    expect((await readProject()).project).toBeNull();
    activateProject(demo);
    expect((await readProject())).toMatchObject({ source: 'fallback', project: { text: 'demo text' } });
  });

  it('backups are listed only for their project', async () => {
    activateProject(demo);
    await addBackup('demo backup', 'demo text');
    activateProject(house);
    expect(await listBackups()).toEqual([]);
    await addBackup('house backup', 'house text');
    expect((await listBackups()).map((b) => [b.label, b.projectId])).toEqual([['house backup', 'sample-house']]);
    activateProject(demo);
    expect((await listBackups()).map((b) => [b.label, b.projectId])).toEqual([['demo backup', 'demo-apartment']]);
  });
});

describe('variant file belongs to its project', () => {
  let n = 0;
  const newId = () => `v-imp-${++n}`;
  const exported = (p: ProjectPackage) => withProject(p, () => { const d = defaultDoc(); return { doc: d, file: exportVariant(d, d.variants[0].id) }; });

  it('export records the project id and name', () => {
    const h = exported(house).file, a = exported(demo).file;
    expect(h.project).toEqual({ id: 'sample-house', name: 'Sample house', docVersion: 1 });
    expect(a.project).toEqual({ id: 'demo-apartment', name: 'Demo apartment', docVersion: 1 });
  });

  it('import: a variant of another project is rejected with the project names; one of the same project is accepted', () => {
    const h = exported(house), a = exported(demo);
    const cross = importVariant(JSON.stringify(h.file), a.doc, docErrors, newId, 'Imported');
    expect(cross).toEqual({ ok: false, errors: ['the file contains a variant of project "sample-house" — it does not match project "demo-apartment"'] });
    const same = importVariant(JSON.stringify(a.file), a.doc, docErrors, newId, 'Imported');
    expect(same.ok).toBe(true);
    // a file without a project id is foreign everywhere
    const anonymous = JSON.stringify({ ...a.file, project: undefined });
    expect(importVariant(anonymous, a.doc, docErrors, newId, 'Imported').ok).toBe(false);
  });
});

describe('save server: every project has its own file under the user data directory', () => {
  const env = process.env.HOME_SIM_USERDATA;
  let dir = '';
  beforeEach(() => { dir = tmp('save'); delete process.env.HOME_SIM_USERDATA; });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); if (env === undefined) delete process.env.HOME_SIM_USERDATA; else process.env.HOME_SIM_USERDATA = env; });
  const FILE = 'userdata/demo-apartment/document.json';
  const file = () => readFileSync(join(dir, FILE), 'utf8');
  const bm = (name: string) => ({ id: name, name, position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 40 });
  const doc = (mark?: string): ConfiguratorDoc => ({ ...defaultDoc(), bookmarks: mark ? [bm(mark)] : [] });
  const txt = (mark?: string) => serializeDoc(doc(mark));

  it('file location: userdata/<id>/document.json; HOME_SIM_USERDATA moves the directory', () => {
    expect(configFile()).toBe(FILE);
    expect(configFile('sample-house')).toBe('userdata/sample-house/document.json');
    process.env.HOME_SIM_USERDATA = 'out/e2e-data/';
    expect(configFile()).toBe('out/e2e-data/demo-apartment/document.json');
  });

  it('each project writes and reads its own file; a document of another project is rejected and nothing changes', () => {
    const demoDoc = txt('flat'), houseDoc = withProject(house, () => serializeDoc(defaultDoc()));
    expect(saveConfig(dir, demoDoc).body).toMatchObject({ ok: true, file: FILE, projectId: 'demo-apartment' });
    expect(withProject(house, () => saveConfig(dir, houseDoc)).body).toMatchObject({ ok: true, file: 'userdata/sample-house/document.json', projectId: 'sample-house' });
    expect(readdirSync(join(dir, 'userdata')).sort()).toEqual(['demo-apartment', 'sample-house']);
    const before = file();
    const cross = saveConfig(dir, houseDoc, hashText(before));
    expect(cross.status).toBe(400);
    expect(String((cross.body.errors as string[])[0])).toMatch(/belongs to project "sample-house"/);
    expect(withProject(house, () => saveConfig(dir, demoDoc, 'force')).status).toBe(400);
    expect(file()).toBe(before);
    expect((loadConfig(dir).body.doc as ConfiguratorDoc).projectId).toBe('demo-apartment');
    expect((withProject(house, () => loadConfig(dir)).body.doc as ConfiguratorDoc).projectId).toBe('sample-house');
  });

  it('no file yet: the load says so (doc null), the first save creates the directory', () => {
    expect(loadConfig(dir)).toEqual({ status: 200, body: { file: FILE, projectId: 'demo-apartment', doc: null } });
    const r = saveConfig(dir, txt(), 'none');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ file: FILE, base: hashText(file()), bytes: Buffer.byteLength(file()) });
    expect(readdirSync(join(dir, 'userdata', 'demo-apartment'))).toEqual(['document.json']);   // no temporary file left
  });

  it('a stale base version is refused (409 conflict): the file is unchanged and nothing else is created; the current base is accepted', () => {
    const a = txt();
    expect(saveConfig(dir, a, 'none').status).toBe(200);
    const fromPhone = txt('phone');
    expect(saveConfig(dir, fromPhone, hashText(a)).status).toBe(200);     // the phone knew version a
    const before = file();
    const r = saveConfig(dir, txt('desktop'), hashText(a));               // the desktop still knows only version a
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ conflict: true, errors: ['the project file has changed since the version this device works on — it was not changed'] });
    expect(file()).toBe(before);
    expect(readdirSync(join(dir, 'userdata', 'demo-apartment'))).toEqual(['document.json']);
    expect(saveConfig(dir, txt('desktop'), hashText(fromPhone)).status).toBe(200);
    expect(JSON.parse(file()).bookmarks[0].name).toBe('desktop');
  });

  it('a device that has not seen the file ("none") or sends no base version (older app) does not replace an existing file', () => {
    expect(saveConfig(dir, txt('user work')).status).toBe(200);             // no file: accepted even without a base version
    const before = file();
    const none = saveConfig(dir, txt(), 'none');
    expect([none.status, none.body.conflict]).toEqual([409, true]);
    const noBase = saveConfig(dir, txt());
    expect(noBase.status).toBe(409);
    expect(String((noBase.body.errors as string[])[0])).toMatch(/update the app/);
    expect(file()).toBe(before);
  });

  it('the base may be the hash of the file as stored (other formatting) — the same version is not a conflict', () => {
    mkdirSync(join(dir, 'userdata', 'demo-apartment'), { recursive: true });
    const compact = JSON.stringify(doc('compact'));
    writeFileSync(join(dir, FILE), compact);
    expect(saveConfig(dir, txt('next'), hashText(compact)).status).toBe(200);
    writeFileSync(join(dir, FILE), compact);
    expect(saveConfig(dir, txt('next'), hashText(serializeDoc(doc('compact')))).status).toBe(200);
    writeFileSync(join(dir, FILE), compact);
    expect(saveConfig(dir, txt('next'), hashText('something else')).status).toBe(409);
  });

  it('a file the app cannot read: a normal save is refused (409 unreadable); a forced one keeps it aside as .unreadable-<time>', () => {
    mkdirSync(join(dir, 'userdata', 'demo-apartment'), { recursive: true });
    const broken = JSON.stringify({ ...doc(), variants: 'damaged' });
    writeFileSync(join(dir, FILE), broken);
    const refused = saveConfig(dir, txt(), 'none');
    expect([refused.status, refused.body.conflict, refused.body.unreadable]).toEqual([409, true, true]);
    expect(refused.body.errors).toEqual(['the project file cannot be read — it was not replaced']);
    expect(file()).toBe(broken);
    const r = saveConfig(dir, txt(), 'force');
    expect(r.status).toBe(200);
    const kept = readdirSync(join(dir, 'userdata', 'demo-apartment')).filter((f) => f.startsWith('document.json.unreadable-'));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, 'userdata', 'demo-apartment', kept[0]), 'utf8')).toBe(broken);
    expect(r.body.backup).toBe(`userdata/demo-apartment/${kept[0]}`);
    expect(file()).toBe(txt());
  });

  it('a forced save over a READABLE file also keeps the replaced version (.replaced-<time>); the same content — no copy', () => {
    const a = txt('file version');
    expect(saveConfig(dir, a, 'none').status).toBe(200);
    expect(saveConfig(dir, a, 'force').body.backup).toBeUndefined();
    const r = saveConfig(dir, txt(), 'force');
    expect(r.status).toBe(200);
    const kept = readdirSync(join(dir, 'userdata', 'demo-apartment')).filter((f) => f.startsWith('document.json.replaced-'));
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(dir, 'userdata', 'demo-apartment', kept[0]), 'utf8')).toBe(a);
    expect(r.body.backup).toBe(`userdata/demo-apartment/${kept[0]}`);
  });

  it('invalid documents are refused before touching the file: syntax, unsupported version, too large', () => {
    expect(saveConfig(dir, '{').status).toBe(400);
    expect(saveConfig(dir, JSON.stringify({ ...doc(), version: 2 })).body.errors).toEqual(['unsupported version: 2']);
    expect(saveConfig(dir, ' '.repeat((8 << 20) + 1)).status).toBe(413);
    expect(existsSync(join(dir, 'userdata'))).toBe(false);
  });

  it('reading a damaged file (truncated JSON, empty file) is not a missing connection: 200 with the reason, doc null', () => {
    mkdirSync(join(dir, 'userdata', 'demo-apartment'), { recursive: true });
    for (const [text, why] of [['{ "schema": "home-simulator/document", "variants": [', /is damaged/], ['', /is empty/]] as const) {
      writeFileSync(join(dir, FILE), text);
      const r = loadConfig(dir);
      expect(r.status).toBe(200);
      expect(r.body.doc).toBeNull();
      expect(String(r.body.unreadable)).toMatch(why);
    }
  });

  describe('HTTP endpoint (/__api/document?project=<id>)', () => {
    type Res = { status: number; body: Record<string, unknown> };
    const call = (method: string, url: string, body?: string, headers: Record<string, string> = {}) => new Promise<Res>((done) => {
      const req = Object.assign(new EventEmitter(), { url, method, headers });
      const out = { statusCode: 0, setHeader: () => {}, end: (b: string) => done({ status: out.statusCode, body: JSON.parse(b) }) };
      configApiMiddleware(dir)(req as never, out as never, () => done({ status: -1, body: {} }));
      if (method === 'PUT') { if (body) req.emit('data', Buffer.from(body)); req.emit('end'); }
    });
    // the endpoint reads packages from <root>/projects — the shipped ones
    beforeEach(() => symlinkSync(join(root, 'projects'), join(dir, 'projects'), 'dir'));

    it('PUT / GET per project in the URL; the base version comes in the x-document-base header', async () => {
      expect(BASE_HEADER).toBe('x-document-base');
      const put = await call('PUT', '/__api/document?project=demo-apartment', txt('one'), { [BASE_HEADER]: 'none' });
      expect(put).toMatchObject({ status: 200, body: { file: FILE, projectId: 'demo-apartment' } });
      const stale = await call('PUT', '/__api/document?project=demo-apartment', txt('two'), { [BASE_HEADER]: 'none' });
      expect(stale.status).toBe(409);
      const ok = await call('PUT', '/__api/document?project=demo-apartment', txt('two'), { [BASE_HEADER]: String(put.body.base) });
      expect(ok.status).toBe(200);
      const got = await call('GET', '/__api/document?project=demo-apartment');
      expect((got.body.doc as ConfiguratorDoc).bookmarks[0].name).toBe('two');
      // the house URL validates on the house package: the apartment document is refused there
      expect((await call('PUT', '/__api/document?project=sample-house', txt('x'), { [BASE_HEADER]: 'none' })).status).toBe(400);
      expect((await call('GET', '/__api/document?project=sample-house')).body).toMatchObject({ projectId: 'sample-house', doc: null });
    });

    it('unknown project → 400; other paths → next(); other methods → 405', async () => {
      expect(await call('GET', '/__api/document?project=nope')).toEqual({ status: 400, body: { errors: ['unknown project'] } });
      expect((await call('GET', '/__api/other')).status).toBe(-1);
      expect((await call('DELETE', '/__api/document?project=demo-apartment')).status).toBe(405);
    });

    it('an error while handling the request ends with a 500 response, not a hanging request', async () => {
      mkdirSync(join(dir, FILE), { recursive: true });                    // a directory where the file should be — reading throws
      const r = await call('GET', '/__api/document?project=demo-apartment');
      expect(r.status).toBe(500);
      expect((r.body.errors as string[])[0]).toBeTruthy();
    });
  });
});

describe('variants survive a save round trip on the server', () => {
  it('a document with several variants is stored and read back unchanged', () => {
    const dir = tmp('round');
    try {
      const d = { ...defaultDoc(), variants: [createVariant('A', 'v-a'), createVariant('B', 'v-b')], activeVariantId: 'v-b' };
      expect(saveConfig(dir, serializeDoc(d)).status).toBe(200);
      expect(loadConfig(dir).body.doc).toEqual(d);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
