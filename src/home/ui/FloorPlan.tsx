// SVG plans in the panels: (1) level — rooms to point at (hover highlights the room in 3D too, click = enter),
// (2) room — selectable walls (materials), furniture as outlines. Orientation as on floor plans: X to the right, Y up.
import { resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { obbCorners } from '../model/geom2d';
import { roomsOfLevel, type HomeRoom } from '../model/rooms';
import type { Arrangement, LevelId } from '../model/types';
import { doorsOfLevel, doorsOfRoom, isInteractive, leafSegment, openOf, swingArc, type DoorDef } from '../model/doors';
import { useDoors } from '../store/doors';
import { ui, useUi } from '../store/ui';
import { fmtNum, t } from '../../i18n';

const KIND_FILL: Record<string, string> = { bath: '#dbe9f4', living: '#f3e9d8', garage: '#e5e5e5', tech: '#e9e9ef', hall: '#efece6', bed: '#e8e1f1', office: '#e3efe3', storage: '#efe8df', kitchen: '#f3e9d8', room: '#e6efe9' };
const pts = (p: [number, number][]) => p.map((q) => `${q[0].toFixed(3)},${(-q[1]).toFixed(3)}`).join(' ');

/** door symbols as on an architectural plan: swing arc + leaf (in its current position); sliding doors — the leaf track.
 *  Tapping a symbol selects the door (card: open / close). With "Show doors" off — arcs only, greyed out. */
export function DoorSymbols({ list }: { list: DoorDef[] }) {
  const st = useDoors((s) => s), sel = useUi((s) => (s.selection?.kind === 'door' ? s.selection.id : null));
  return (
    <g className={`hm-plan-doors${st.show ? '' : ' off'}`} data-testid="plan-doors">
      {list.map((d) => {
        // entrance doors (exterior joinery): symbol as on the plan — leaf open, no action
        const act = isInteractive(d), op = act ? openOf(st, d.id) : 1, leaf = leafSegment(d, d.hinge ? Math.max(op, 0.0001) : op), arc = swingArc(d);
        if (!leaf) return null;
        return (
          <g key={d.id} className={`hm-plan-door${sel === d.id ? ' on' : ''}${op >= 0.5 ? ' open' : ''}${act ? '' : ' fixed'}`} data-door={d.id} data-open={act && op >= 0.5 ? '1' : '0'}
            onClick={act ? (e) => { e.stopPropagation(); ui.set({ selection: sel === d.id ? null : { kind: 'door', id: d.id } }); } : undefined}>
            <polyline points={pts(arc)} className="arc" />
            {(st.show || !act) && <line x1={leaf.a[0]} y1={-leaf.a[1]} x2={leaf.b[0]} y2={-leaf.b[1]} className="leaf" />}
            {act && <polyline points={pts(d.hinge ? [...arc, d.hinge] : arc)} className="hit" />}
          </g>
        );
      })}
    </g>
  );
}

export function LevelPlan({ level, onRoom }: { level: LevelId; onRoom: (r: HomeRoom) => void }) {
  const rooms = roomsOfLevel(level);
  const hover = useUi((s) => s.hoverRoom);
  const xs = rooms.flatMap((r) => [r.bbox[0], r.bbox[2]]), ys = rooms.flatMap((r) => [r.bbox[1], r.bbox[3]]);
  const x0 = Math.min(...xs) - 0.3, x1 = Math.max(...xs) + 0.3, y0 = Math.min(...ys) - 0.3, y1 = Math.max(...ys) + 0.3;
  return (
    <svg className="hm-plan" viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`} data-testid={`plan-${level}`} role="img" aria-label={t('floorPlan.levelPlan')}>
      {rooms.map((r) => {
        const small = r.area < 6;
        return (
          <g key={r.id} className={`hm-plan-room${hover === r.id ? ' on' : ''}`} data-room={r.id}
            onPointerEnter={() => ui.set({ hoverRoom: r.id })} onPointerLeave={() => ui.get().hoverRoom === r.id && ui.set({ hoverRoom: null })} onClick={() => onRoom(r)}>
            <polygon points={pts(r.polygon)} fill={KIND_FILL[r.kind] ?? '#eee'} />
            <text x={r.center[0]} y={-r.center[1] + (small ? 0.1 : 0)} fontSize={small ? 0.32 : 0.42} textAnchor="middle">{r.label}</text>
            {!small && <text x={r.center[0]} y={-r.center[1] + 0.55} fontSize={0.32} textAnchor="middle" className="sub">{fmtNum(r.area, 1)} m²</text>}
          </g>
        );
      })}
      <DoorSymbols list={doorsOfLevel(level)} />
    </svg>
  );
}

/** room plan: walls (selectable), floor, furniture */
export function RoomPlan({ room, arrangement, selectedWall, onWall, onFloor, testid }: {
  room: HomeRoom; arrangement: Arrangement; selectedWall?: string | string[] | null; onWall?: (wallId: string, add: boolean) => void; onFloor?: () => void; testid?: string;
}) {
  const [x0, y0, x1, y1] = room.bbox, pad = 0.45;
  const fin = arrangement.finishes;
  return (
    <svg className="hm-plan hm-plan-room-view" viewBox={`${x0 - pad} ${-y1 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`} data-testid={testid}>
      <polygon points={pts(room.polygon)} className={`hm-plan-floor${fin.floor ? ' set' : ''}`} onClick={onFloor} />
      {arrangement.furniture.map((f) => {
        const it = itemById(f.catalogId);
        if (!it) return null;
        const d = resolveDims(it, f);
        return <polygon key={f.id} className={`hm-plan-furn${it.flat ? ' flat' : ''}`} points={pts(obbCorners({ c: [f.x, f.y], hw: d.w / 2, hd: d.d / 2, rot: f.rot }))} />;
      })}
      {room.walls.map((w) => {
        const set = !!fin.walls[w.id];
        const m: [number, number] = [(w.a[0] + w.b[0]) / 2 + w.inward[0] * 0.28, (w.a[1] + w.b[1]) / 2 + w.inward[1] * 0.28];
        return (
          <g key={w.id} className={`hm-plan-wall${(Array.isArray(selectedWall) ? selectedWall.includes(w.id) : selectedWall === w.id) ? ' on' : ''}${set ? ' set' : ''}`} data-wall={w.id} onClick={(e) => onWall?.(w.id, e.ctrlKey || e.metaKey || e.shiftKey)}>
            <line x1={w.a[0]} y1={-w.a[1]} x2={w.b[0]} y2={-w.b[1]} className="hit" />
            <line x1={w.a[0]} y1={-w.a[1]} x2={w.b[0]} y2={-w.b[1]} className="vis" style={set ? { stroke: fin.walls[w.id].color ?? undefined } : undefined} />
            {w.holes.map((h) => {
              const a: [number, number] = [w.a[0] + w.dir[0] * h.t0, w.a[1] + w.dir[1] * h.t0], b: [number, number] = [w.a[0] + w.dir[0] * h.t1, w.a[1] + w.dir[1] * h.t1];
              return <line key={h.id} x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className={`hole ${h.kind}`} />;
            })}
            {/* the wall number belongs to the wall's hit area: it sits 28 cm into the room, outside the line's hit band (±25 cm) — clicking the number used to select the floor */}
            <circle cx={m[0]} cy={-m[1]} r={0.2} className="num" />
            <text x={m[0]} y={-m[1] + 0.1} fontSize={0.26} textAnchor="middle">{w.index}</text>
          </g>
        );
      })}
      <DoorSymbols list={doorsOfRoom(room.id)} />
    </svg>
  );
}
