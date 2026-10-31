// The state matrix the UI rules render (scripts/audit/ui-rules.ts): both example projects × English and Polish × simple and
// advanced mode × desktop and phone, in the states of the three steps — outside, choosing a room, in a room (furniture, a
// selected piece, colours), versions (one and two), settings, the Download menu, the welcome screen.
import path from 'node:path';
import { createElement } from 'react';
import { defaultDoc, type ConfiguratorDoc } from '../../src/document/model';
import { initHistory } from '../../src/history/history';
import { withProject } from '../../src/project/active';
import { readProjectDir } from '../../src/project/node';
import type { ProjectPackage } from '../../src/project/types';
import { allRooms } from '../../src/home/model/rooms';
import { arrangementOf, design } from '../../src/home/store/design';
import { layout } from '../../src/home/store/layout';
import { ui, type UiState } from '../../src/home/store/ui';
import { ExpertPanel } from '../../src/home/ui/ExpertPanel';
import { Inspector } from '../../src/home/ui/Inspector';
import { ObjectBar, SceneBar } from '../../src/home/ui/SceneBar';
import { SectionArrange } from '../../src/home/ui/SectionArrange';
import { SectionLook } from '../../src/home/ui/SectionLook';
import { SectionVariants } from '../../src/home/ui/SectionVariants';
import { Settings } from '../../src/home/ui/Settings';
import { Hint, Onboarding } from '../../src/home/ui/Shell';
import { TopBar } from '../../src/home/ui/TopBar';
import { renderChrome, ROOT, withLang, type RenderedState } from './ui-rules';

const PANEL = { look: SectionLook, arrange: SectionArrange, variants: SectionVariants, expert: ExpertPanel, electrical: null } as const;

function chrome(): string {
  const panel = PANEL[ui.get().section];
  return renderChrome([
    () => createElement(TopBar), () => (panel ? createElement(panel) : createElement('div')), () => createElement(SceneBar), () => createElement(ObjectBar),
    () => createElement(Inspector), () => createElement(Settings), () => createElement(Onboarding), () => createElement(Hint),
  ]);
}

export function chromeStates(projects: ProjectPackage[] = ['demo-apartment', 'sample-house'].map((id) => readProjectDir(path.join(ROOT, 'projects', id)))): RenderedState[] {
  const out: RenderedState[] = [];
  const ui0 = ui.get(), design0 = design.get(), layout0 = layout.get();
  try {
    for (const pkg of projects) withProject(pkg, () => {
      const doc = defaultDoc(), two: ConfiguratorDoc = { ...doc, variants: [...doc.variants, { ...doc.variants[0], id: 'v-2', name: 'Version 2' }] };
      const room = [...allRooms()].sort((a, b) => b.area - a.area)[0];
      const base: Partial<UiState> = { settingsOpen: false, onboardingDone: true, menu: null, selection: null, compare: null, comparePick: false, importOpen: false, hoverRoom: null, wallScope: 'all', level: room.level };
      const furniture = () => arrangementOf(design.get(), room.id).furniture[0]?.id;
      const states: [string, Partial<UiState>, ConfiguratorDoc?][] = [
        ['look', { section: 'look', roomId: null, houseView: 'exterior' }],
        ['arrange-pick', { section: 'arrange', roomId: null, houseView: 'interior' }],
        ['arrange-room', { section: 'arrange', roomId: room.id, houseView: 'interior', arrangeTab: 'furniture' }],
        ['arrange-selected', { section: 'arrange', roomId: room.id, houseView: 'interior', arrangeTab: 'furniture', selection: { kind: 'furniture', roomId: room.id, id: '' } }],
        ['arrange-colours', { section: 'arrange', roomId: room.id, houseView: 'interior', arrangeTab: 'colours', selection: { kind: 'wall', roomId: room.id, wallId: room.walls[0].id } }],
        ['versions', { section: 'variants', roomId: null, houseView: 'exterior' }],
        ['versions-two', { section: 'variants', roomId: null, houseView: 'exterior' }, two],
        ['walk', { section: 'look', roomId: null, houseView: 'walk' }],
        ['settings', { section: 'look', roomId: null, houseView: 'exterior', settingsOpen: true }],
        ['download', { section: 'look', roomId: null, houseView: 'exterior', menu: 'download' }],
        ['welcome', { section: 'look', roomId: null, houseView: 'exterior', onboardingDone: false }],
      ];
      for (const mode of ['simple', 'advanced'] as const) for (const phone of [false, true]) for (const lang of ['en', 'pl'] as const) {
        layout.set({ mobile: phone, coarse: phone, landscape: !phone });
        for (const [name, st, d] of [...states, ...(mode === 'advanced' ? [['expert', { section: 'expert', roomId: null, houseView: 'exterior' }] as [string, Partial<UiState>]] : [])]) {
          design.set({ history: initHistory(d ?? doc), draft: null, loaded: true });
          ui.set({ ...base, mode, ...st });
          const sel = ui.get().selection;
          if (sel?.kind === 'furniture' && !sel.id) { const id = furniture(); ui.set({ selection: id ? { kind: 'furniture', roomId: room.id, id } : null }); }
          out.push({ name: `${pkg.manifest.projectId} ${mode} ${phone ? 'phone' : 'desktop'} ${lang} ${name}`, mode, lang, html: withLang(lang, chrome) });
        }
      }
    });
  } finally {
    ui.set(ui0); design.set(design0); layout.set(layout0);
  }
  return out;
}
