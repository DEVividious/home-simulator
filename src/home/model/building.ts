// The derived building of the active project — the core's pure model (@home-sim/core/model/building, ADR 0023) adapted
// to the active-project cache (ADR 0001). Model modules (rooms, stairs, shell) read it through here.
import { building as coreBuilding, type Building } from '@home-sim/core/model/building';
import { derived } from '../../project/active';

export const building = derived((p): Building => coreBuilding(p.building));
