// "Restore project furniture" — the furnishing of ALL rooms returns to the project layout in one step. It changes only the
// furniture of each room's active arrangement: finishes, saved arrangements, the view and the electrical plan stay.
// Data: demo apartment (rooms R1–R4, TV "arch-R1-tv" in R1).
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultDoc } from '../../document/model';
import { initHistory } from '../../history/history';
import { resetFurnitureToProject, saveArrangementAs } from '../actions';
import { defaultFurniture } from '../model/defaults';
import { addFurniture, removeFurniture, setFinish, updateFurniture } from '../model/interiors';
import { allRooms } from '../model/rooms';
import { arrangementOf, design, interiorOfRoom, undo, updateArrangement, updateVariant, variantOf } from '../store/design';
import { ui } from '../store/ui';

const past = () => design.get().history.past.length;
const furniture = (roomId: string) => arrangementOf(design.get(), roomId).furniture;
beforeEach(() => { design.set({ history: initHistory(defaultDoc()), saved: null, draft: null, loaded: true }); ui.set({ selection: null }); });

describe('restoring the project furniture in all rooms', () => {
  it('data: every room of the demo apartment has project furniture', () => {
    expect(allRooms().map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
    for (const r of allRooms()) expect(defaultFurniture(r.id).length, r.id).toBeGreaterThan(0);
  });
  it('moved, removed and added furniture in several rooms returns to the project layout — one history entry, Undo restores', () => {
    updateArrangement('R1', 'tv', (a) => updateFurniture(a, 'arch-R1-tv', { x: 5.8, elevation: 1.4 }));
    updateArrangement('R2', 'remove', (a) => removeFurniture(a, a.furniture[0].id));
    updateArrangement('R4', 'desk', (a) => addFurniture(a, { id: 'f-test', catalogId: 'desk', x: 1.2, y: 1.5, rot: 0 }));
    ui.set({ selection: { kind: 'furniture', roomId: 'R4', id: 'f-test' } });
    const changed = design.get().history.present, h0 = past();
    expect(furniture('R1')).not.toEqual(defaultFurniture('R1'));
    expect(resetFurnitureToProject()).toBe(true);
    for (const r of allRooms()) expect(furniture(r.id), `room ${r.id}`).toEqual(defaultFurniture(r.id));
    expect(past()).toBe(h0 + 1);
    expect(ui.get().selection).toBeNull();                                      // the selected item no longer exists
    undo();
    expect(design.get().history.present).toBe(changed);
  });
  it('finishes, saved arrangements and the rest of the variant stay', () => {
    updateArrangement('R1', 'floor', (a) => setFinish(a, { kind: 'floor' }, { materialId: 'floor-oak-natural' }));
    saveArrangementAs('R1', 'My arrangement');                                 // named arrangement — not the active working one
    updateArrangement('R1', 'tv', (a) => updateFurniture(a, 'arch-R1-tv', { x: 5.8 }));
    updateVariant('view', (v) => ({ ...v, view: { position: [5, -4, 6], target: [5, 2, 0], fov: 50, environment: true } }));
    const before = variantOf(design.get()), ri0 = interiorOfRoom(design.get(), 'R1'), active0 = ri0.arrangements.find((a) => a.id === ri0.activeArrangementId)!;
    expect(resetFurnitureToProject()).toBe(true);
    const after = variantOf(design.get()), ri = interiorOfRoom(design.get(), 'R1'), active = ri.arrangements.find((a) => a.id === ri.activeArrangementId)!;
    expect(active.furniture).toEqual(defaultFurniture('R1'));
    expect(active.finishes).toEqual(active0.finishes);
    expect(ri.arrangements.map((a) => [a.id, a.name])).toEqual(ri0.arrangements.map((a) => [a.id, a.name]));
    for (const a of ri.arrangements) if (a.id !== active.id) expect(a).toBe(ri0.arrangements.find((x) => x.id === a.id));
    const strip = (v: typeof after) => { const { interiors: _i, ...rest } = v; void _i; return rest; };
    expect(strip(after)).toEqual(strip(before));                                // view, electrical, the rest of the variant — unchanged
  });
  it('when everything already comes from the project: nothing changes, no history entry', () => {
    const h0 = past(), doc = design.get().history.present;
    expect(resetFurnitureToProject()).toBe(false);
    expect(past()).toBe(h0);
    expect(design.get().history.present).toBe(doc);
  });
});
