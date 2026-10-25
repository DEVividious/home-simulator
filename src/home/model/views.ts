// Exterior building views (camera presets) — from the project package (project().views): names and directions are facts
// of the building ("from the street", "garden side"). The engine frames the view from the direction and the building
// outline; a view that a direction cannot describe (e.g. eye level in front of the entrance) carries an explicit camera
// pose instead (ADR 0007 — no project code in the engine). A project without views gets the default set. The level
// section ("Interior") always exists — computed from the room outlines.
import { t } from '../../i18n';
import { project } from '../../project/active';
import type { Vec3 } from './types';

/** explicit camera pose in project coordinates */
export interface CameraViewPose { position: Vec3; target: Vec3; fov: number }

export interface ViewPreset {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** direction from the building centre to the camera (project coordinates) — the whole building in frame */
  dir?: Vec3;
  /** explicit camera pose; used when `dir` is absent */
  pose?: CameraViewPose;
  /** framing distance multiplier (default 1.02) */
  fit?: number;
}

/** project views: list, start view */
export interface ProjectViews { presets: ViewPreset[]; home?: string }

export const INTERIOR_VIEW_ID = 'interior';
export const DEFAULT_VIEW_DIR: Vec3 = [-0.62, -0.78, 0.6];
/** default views of the engine (labels in the UI language) */
let defaults: ViewPreset[] | null = null;
const defaultViews = (): ViewPreset[] => (defaults ??= [
  { id: 'overview', label: t('views.overview'), icon: 'house', hint: t('views.overview.hint'), dir: DEFAULT_VIEW_DIR },
  { id: 'opposite', label: t('views.opposite'), icon: 'exterior', hint: t('views.opposite.hint'), dir: [0.62, 0.78, 0.6] },
  { id: 'top', label: t('views.top'), icon: 'roof', hint: t('views.top.hint'), dir: [-0.05, -0.2, 1], fit: 0.95 },
]);
let interior: ViewPreset | null = null;
/** the level section view — always available */
export const interiorView = (): ViewPreset => (interior ??= { id: INTERIOR_VIEW_ID, label: t('views.interior'), icon: 'interior', hint: t('views.interior.hint') });

/** exterior views */
export const exteriorViews = (): ViewPreset[] => project().views?.presets ?? defaultViews();
/** views in the bottom bar and the building section: exterior + level section */
export const viewPresets = (): ViewPreset[] => [...exteriorViews(), interiorView()];
export const viewById = (id: string): ViewPreset | null => exteriorViews().find((v) => v.id === id) ?? null;
/** start view (also after leaving walk mode or a section) */
export const homeViewId = (): string => { const v = project().views; return v?.home && viewById(v.home) ? v.home : exteriorViews()[0].id; };
