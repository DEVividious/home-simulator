// Scene sides: without a comparison — one side A = the active variant; in an A/B comparison — two sides with variant data
// (or the same variant with different arrangements of one room). Camera, light, surroundings and the home model are shared —
// the sides differ only in variant data (joinery, facade, interiors).
import { useMemo } from 'react';
import type { Variant } from '../../document/model';
import { roomById } from '../model/rooms';
import type { RoomInterior } from '../model/types';
import type { FullVariant } from '../model/variantData';
import { docOf, stableInterior, useDesign } from './design';
import { useUi, type Compare } from './ui';
import type { ConfiguratorDoc } from '../../document/model';

export interface Side { id: 'A' | 'B'; variant: FullVariant; interiors: Record<string, RoomInterior>; label: string }

function withArrangement(v: Variant, roomId: string, arrId: string): Record<string, RoomInterior> {
  const ri = stableInterior(v.interiors, roomId);
  return { ...v.interiors, [roomId]: { ...ri, activeArrangementId: arrId } };
}

export function sidesOf(doc: ConfiguratorDoc, compare: Compare): Side[] {
  const active = (doc.variants.find((v) => v.id === doc.activeVariantId) ?? doc.variants[0]) as FullVariant;
  if (compare?.kind === 'variants') {
    const a = doc.variants.find((v) => v.id === compare.a) as FullVariant | undefined, b = doc.variants.find((v) => v.id === compare.b) as FullVariant | undefined;
    if (a && b) return [{ id: 'A', variant: a, interiors: a.interiors, label: a.name }, { id: 'B', variant: b, interiors: b.interiors, label: b.name }];
  }
  if (compare?.kind === 'room') {
    const ri = stableInterior(active.interiors, compare.roomId), room = roomById(compare.roomId);
    const na = ri.arrangements.find((x) => x.id === compare.a), nb = ri.arrangements.find((x) => x.id === compare.b);
    if (na && nb) {
      const rn = room ? room.label : compare.roomId;
      return [{ id: 'A', variant: active, interiors: withArrangement(active, compare.roomId, na.id), label: `${rn}: ${na.name}` },
        { id: 'B', variant: active, interiors: withArrangement(active, compare.roomId, nb.id), label: `${rn}: ${nb.name}` }];
    }
  }
  return [{ id: 'A', variant: active, interiors: active.interiors, label: active.name }];
}

export function useSides(): Side[] {
  const doc = useDesign(docOf), compare = useUi((s) => s.compare);
  return useMemo(() => sidesOf(doc, compare), [doc, compare]);
}
