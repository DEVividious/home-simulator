// Scene data of the configurator: building bounds in space (camera, light, shadows) and the URLs of the project's model files
// (project assets, ADR 0010). A project without a building model file gets the bounds of the shell generated from its rooms.
import { project } from '../../project/active';
import { assetUrl } from '../../project/registry';
import { shellBounds } from '../model/shell';
import type { Vec3 } from '../model/types';

export interface SceneBounds { min: Vec3; max: Vec3 }
export interface SceneAssets {
  /** building model (GLB) or null — generated shell */
  model: string | null;
  /** terrain model (GLB), module `site` */
  site: string | null;
  /** surroundings model (GLB), module `environment` */
  environment: string | null;
}
export interface SceneData { bounds: SceneBounds; assets: SceneAssets }

export function sceneDataOf(): SceneData {
  const a = project().assets, mods = project().manifest.modules;
  return {
    bounds: a?.bounds ?? shellBounds(),
    assets: {
      model: a?.model ? assetUrl(a.model) : null,
      site: a?.site && mods.includes('site') ? assetUrl(a.site) : null,
      environment: a?.environment && mods.includes('environment') ? assetUrl(a.environment) : null,
    },
  };
}
