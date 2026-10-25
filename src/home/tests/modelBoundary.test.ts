// Furniture with a GLB model whose file is missing (404: a variant imported on another computer, a phone offline without a copy
// of the model). `useGLTF` throws while rendering; without an error boundary around the model itself the WHOLE scene was
// unmounted — on every app start. Here: the model boundary draws a placeholder solid, reports the missing file ONCE and leaves
// the rest of the scene alone. React catching the exception is covered by the browser test; here — the state after the error and the report.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import type { CatalogItem } from '../catalog/furniture';
import { importedItem } from '../catalog/providers';
import { FurnitureModel, ModelBoundary, swallowHandledModelError } from '../scene/FurnitureLayer';
import { ui } from '../store/ui';

const NAME = 'Imported armchair';
const asset = (id: string, name: string) => ({ id, name, file: `${id}.glb`, bytes: 1000, triangles: 100, dims: { w: 0.8, d: 0.8, h: 0.9 }, scale: 1, offset: [0, 0, 0] as [number, number, number], category: 'living', warnings: [], createdAt: '2026-10-01T10:00:00.000Z' });
const ITEM: CatalogItem = importedItem(asset('ghost1', NAME) as never);
const DIMS = { w: 0.8, d: 0.8, h: 0.9 };
const CHILD = createElement('group', { name: 'MODEL' }), FALLBACK = createElement('group', { name: 'PLACEHOLDER' });
const boundary = (url: string, name = NAME) => new ModelBoundary({ url, name, fallback: FALLBACK, children: CHILD });
/** boundary after a caught error (React sets the state: getDerivedStateFromError, then componentDidCatch) */
function caught(url: string, name?: string, error: unknown = new Error(`Could not load ${url}: 404`)) {
  const b = boundary(url, name);
  b.state = { ...b.state, ...ModelBoundary.getDerivedStateFromError(error) };
  b.componentDidCatch(error);
  return b;
}
type El = ReactElement<{ children?: ReactNode; fallback?: ReactNode; url?: string; name?: string }>;

let warned: ReturnType<typeof vi.spyOn>;
beforeEach(() => { ui.set({ toast: null }); warned = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warned.mockRestore());

describe('GLB model error boundary (missing model file)', () => {
  it('without an error renders the model', () => {
    expect(boundary('/user-assets/furniture/imported/a1.glb').render()).toBe(CHILD);
  });

  it('after a load error: placeholder solid instead of the model and a message with the furniture name — no exception for the rest of the scene', () => {
    const b = caught('/user-assets/furniture/imported/a2.glb');
    expect(b.render()).toBe(FALLBACK);
    const toast = ui.get().toast;
    expect(toast?.level).toBe('warn');
    expect(toast?.text).toContain(NAME);
    expect(toast?.text).toBe(t('scene.modelLoadFailed', { name: NAME }));
    // the cause stays in the console as a warning (diagnostics) — not as an unhandled exception
    expect(warned).toHaveBeenCalledTimes(1);
    expect(String(warned.mock.calls[0][0])).toContain('/user-assets/furniture/imported/a2.glb');
  });

  it('a missing file is reported ONCE — not for every instance of the furniture and not after remounting', () => {
    caught('/user-assets/furniture/imported/a3.glb');
    const n = ui.get().toast!.n;
    caught('/user-assets/furniture/imported/a3.glb');                       // second instance of the same model
    caught('/user-assets/furniture/imported/a3.glb');                       // the same furniture after a view change (new boundary instance)
    expect(ui.get().toast!.n).toBe(n);
    caught('/user-assets/furniture/imported/a4.glb', 'Imported lamp');      // another file — a separate message
    expect(ui.get().toast!.n).toBe(n + 1);
    expect(ui.get().toast!.text).toContain('Imported lamp');
  });

  it('a different model at the same place in the scene (another 3D model chosen) clears the placeholder', () => {
    const b = caught('/user-assets/furniture/imported/a5.glb');
    const next = ModelBoundary.getDerivedStateFromProps({ url: '/user-assets/furniture/imported/a6.glb', name: 'x', fallback: FALLBACK }, b.state);
    expect(next).toEqual({ failed: false, url: '/user-assets/furniture/imported/a6.glb' });
    expect(ModelBoundary.getDerivedStateFromProps({ url: '/user-assets/furniture/imported/a5.glb', name: 'x', fallback: FALLBACK }, b.state)).toBeNull();
  });

  it('an error handled by the boundary is not reported as an unhandled page exception (the scene reports every caught error so); other errors — unchanged', () => {
    const err = new Error('Could not load /user-assets/furniture/imported/a7.glb: 404'), other = new Error('another error');
    caught('/user-assets/furniture/imported/a7.glb', NAME, err);
    let stopped = 0;
    const event = (error: unknown) => ({ error, preventDefault: () => { stopped++; } });
    swallowHandledModelError(event(err));
    expect(stopped).toBe(1);
    swallowHandledModelError(event(other));
    swallowHandledModelError(event(undefined));
    swallowHandledModelError(event('text'));
    expect(stopped).toBe(1);
  });

  it('the GLB model of a furniture item is drawn INSIDE the boundary, with a placeholder solid of the item dimensions', () => {
    const el = FurnitureModel({ item: ITEM, p: { variant: null, materialId: null }, dims: DIMS }) as El;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe(ModelBoundary);
    expect(el.props.url).toBe('/user-assets/furniture/imported/ghost1.glb');
    expect(el.props.name).toBe(NAME);
    expect(isValidElement(el.props.fallback)).toBe(true);
    expect((el.props.fallback as ReactElement<{ dims: typeof DIMS }>).props.dims).toEqual(DIMS);
  });
});
