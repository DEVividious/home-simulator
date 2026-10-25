// One tab = one project: the tab remembers its project (sessionStorage) for links without ?project=. After switching projects
// and going "Back", the browser may show the previous page from memory (bfcache) without reloading it — the page being shown
// must become the tab's project again; otherwise links without the parameter open the project the user just came back from.
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateProject, projectId } from '../active';
import { readProjectDir } from '../node';
import { loadProject, resolveProjectId, switchProject } from '../registry';

const root = path.resolve(__dirname, '..', '..', '..');
const HOUSE = 'sample-house', DEMO = 'demo-apartment';
const packages = Object.fromEntries([HOUSE, DEMO].map((id) => [`/projects/${id}/project.json`, readProjectDir(path.join(root, 'projects', id))]));

describe('the tab project after going Back', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url in packages ? new Response(JSON.stringify(packages[url]), { status: 200 }) : new Response('', { status: 404 }))));
  });
  afterEach(() => { vi.unstubAllGlobals(); activateProject(packages[`/projects/${DEMO}/project.json`]); });

  it('a page restored from the browser memory (pageshow) becomes the tab project again', async () => {
    const tab = new Map<string, string>(), onShow: (() => void)[] = [];
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => { tab.set(k, v); } });
    vi.stubGlobal('window', { location: { search: '' }, addEventListener: (type: string, fn: () => void) => { if (type === 'pageshow') onShow.push(fn); } });
    // page A: the house — the tab remembers the house
    await loadProject(HOUSE);
    expect(projectId()).toBe(HOUSE);
    expect(resolveProjectId('')).toBe(HOUSE);
    // switching projects: the new page (the apartment) in the same tab remembers its project
    const [key] = [...tab.keys()];
    expect(key).toBe('home-simulator.project');
    tab.set(key, DEMO);
    expect(resolveProjectId('')).toBe(DEMO);
    // Back: the browser shows page A without loading it again — only the pageshow event arrives
    expect(onShow).toHaveLength(1);
    onShow[0]();
    expect(resolveProjectId('')).toBe(HOUSE);
    expect(projectId()).toBe(HOUSE);
    // the URL parameter still wins
    expect(resolveProjectId(`?project=${DEMO}`)).toBe(DEMO);
  });

  // When the browser does NOT keep the page in memory (a page with a 3D scene often does not qualify), "Back" loads its URL
  // again. A URL without the parameter would mean "the tab project" — the one just switched to. The page being left therefore
  // gets its own project in the URL.
  it('switching projects: the page being left gets its project in the URL — Back returns to it even after a full reload', async () => {
    const replaced: string[] = [], assigned: string[] = [], device = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('localStorage', { getItem: (k: string) => device.get(k) ?? null, setItem: (k: string, v: string) => { device.set(k, v); } });
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4170/?onboarding=off', search: '?onboarding=off', assign: (u: URL | string) => { assigned.push(String(u)); } },
      history: { state: { k: 1 }, replaceState: (_s: unknown, _t: string, u: URL | string) => { replaced.push(String(u)); } },
      addEventListener: () => {},
    });
    await loadProject(HOUSE);
    switchProject(DEMO);
    expect(replaced).toEqual([`http://localhost:4170/?onboarding=off&project=${HOUSE}`]);
    expect(assigned).toEqual([`http://localhost:4170/?project=${DEMO}`]);
    // the choice is remembered on the device
    expect(device.get('home-simulator.project')).toBe(DEMO);
    // the URL in the history points at the project of the page that was left, whatever the tab remembers
    expect(resolveProjectId(new URL(replaced[0]).search)).toBe(HOUSE);
  });
});
