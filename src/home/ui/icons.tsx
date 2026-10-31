// UI icons (simple 24 × 24 line shapes drawn in SVG — no emoji fonts and no external packages).
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  house: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></>,
  exterior: <><path d="M3 20h18" /><path d="M5 20V9l7-5 7 5v11" /><rect x="8" y="12" width="3" height="3" /><rect x="13" y="12" width="3" height="3" /></>,
  interior: <><rect x="3.5" y="4" width="17" height="16" rx="1.5" /><path d="M3.5 12h8V4" /><path d="M15 20v-5h5.5" /></>,
  brush: <><path d="M14.5 4.5 19.5 9.5 11 18l-5-5z" /><path d="M6 13c-2 1-2.5 3-2.5 6.5C7 19.5 9 19 10 17" /></>,
  sofa: <><path d="M4 11V8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V11" /><path d="M3 11.5A1.5 1.5 0 0 1 6 11.5V14h12v-2.5a1.5 1.5 0 0 1 3 0V17H3z" /><path d="M5 17v2M19 17v2" /></>,
  layers: <><path d="m12 4 8.5 4.5L12 13 3.5 8.5z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></>,
  undo: <><path d="M9 7 4.5 11.5 9 16" /><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" /></>,
  redo: <><path d="m15 7 4.5 4.5L15 16" /><path d="M19 11.5H9.5a5 5 0 0 0 0 10H12" /></>,
  save: <><path d="M5 4h11l3.5 3.5V20H5z" /><path d="M8 4v5h7V4" /><rect x="8" y="13" width="8" height="5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  next: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  up: <path d="M5.5 14.5 12 8l6.5 6.5" />,
  down: <path d="M5.5 9.5 12 16l6.5-6.5" />,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M12 16.8v.4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="1.5" /><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /></>,
  rotl: <><path d="M4.5 9A8 8 0 1 1 4 13" /><path d="M4.5 4v5h5" /></>,
  rotr: <><path d="M19.5 9A8 8 0 1 0 20 13" /><path d="M19.5 4v5h-5" /></>,
  cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  top: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 10h7v10M14 4v6h6" /></>,
  walk: <><circle cx="12.5" cy="4.5" r="1.8" /><path d="m9 21 2.5-6.5L14 17v4" /><path d="M11.5 14.5 12 9l-3.5 2V14" /><path d="m12 9 2.5 2.5 2.5.5" /></>,
  camera: <><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  warn: <><path d="M12 4 21 19.5H3z" /><path d="M12 10v4.5M12 17v.5" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.5v.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></>,
  door: <><path d="M6 20.5V3.5h11v17" /><path d="M4 20.5h16" /><circle cx="14.5" cy="12" r=".8" /></>,
  window: <><rect x="4.5" y="4.5" width="15" height="15" /><path d="M12 4.5v15M4.5 12h15" /></>,
  garage: <><path d="M3 20V9l9-5 9 5v11" /><path d="M6.5 20v-8h11v8M6.5 15h11M6.5 17.5h11" /></>,
  roof: <><path d="m3 15 9-9 9 9" /><path d="m10 10.5 2-2 2 2v2h-4z" /></>,
  tree: <><path d="M12 21v-5" /><path d="M12 3c3 0 5.5 2.5 5.5 5.5 1.5.8 2.5 2.3 2.5 4A4.5 4.5 0 0 1 15.5 17h-7A4.5 4.5 0 0 1 4 12.5c0-1.7 1-3.2 2.5-4C6.5 5.5 9 3 12 3z" /></>,
  bed: <><path d="M3 18.5V6" /><path d="M3 14h18v4.5" /><path d="M3 10.5h6.5a2 2 0 0 1 2 2V14" /><path d="M11.5 10.5H18a3 3 0 0 1 3 3v.5" /></>,
  desk: <><path d="M3 8h18" /><path d="M4.5 8v11M19.5 8v11" /><rect x="13" y="8" width="6.5" height="5.5" /></>,
  bath: <><path d="M3.5 12h17v2.5a4.5 4.5 0 0 1-4.5 4.5H8a4.5 4.5 0 0 1-4.5-4.5z" /><path d="M6 12V5.5A1.5 1.5 0 0 1 9 5.5" /><path d="M7 19l-1 2M17 19l1 2" /></>,
  box: <><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" /><path d="M4 7.5 12 11l8-3.5M12 11v9" /></>,
  plant: <><path d="M8 15h8l-1 6H9z" /><path d="M12 15V9" /><path d="M12 10c0-3 2-5 6-5 0 4-2 6-6 5z" /><path d="M12 12c0-2.5-1.7-4-5-4 0 3 1.7 4.5 5 4z" /></>,
  kitchen: <><rect x="4" y="3.5" width="16" height="17" rx="1" /><path d="M4 9h16M8 6.2h.5M11 6.2h.5" /><circle cx="12" cy="14.5" r="3" /></>,
  ruler: <><path d="m3.5 15.5 12-12 5 5-12 12z" /><path d="m7.5 11.5 2 2M10.5 8.5l2 2M13.5 5.5l2 2" /></>,
  upload: <><path d="M12 15V4.5M7.5 9 12 4.5 16.5 9" /><path d="M4.5 15.5v4h15v-4" /></>,
  plug: <><path d="M9 3.5v4M15 3.5v4" /><path d="M6.5 7.5h11v4a5.5 5.5 0 0 1-11 0z" /><path d="M12 17v3.5" /></>,
  download: <><path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 15.5v4h15v-4" /></>,
  bulb: <><path d="M9 17.5h6M10 20.5h4" /><path d="M8.2 14.5a6 6 0 1 1 7.6 0c-.6.6-.8 1.2-.8 2H9c0-.8-.2-1.4-.8-2z" /></>,
  switch: <><rect x="5" y="4" width="14" height="16" rx="2.5" /><rect x="9" y="7.5" width="6" height="9" rx="1.2" /><path d="M12 10v2" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" /></>,
  wifi: <><path d="M4 9.5a12 12 0 0 1 16 0" /><path d="M7 13a7.5 7.5 0 0 1 10 0" /><path d="M10 16.3a3.2 3.2 0 0 1 4 0" /><circle cx="12" cy="19" r="0.6" /></>,
  sensor: <><circle cx="12" cy="12" r="2.2" /><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9" /><path d="M4.8 5a10 10 0 0 0 0 14M19.2 5a10 10 0 0 1 0 14" /></>,
  move: <><path d="M12 3.5v17M3.5 12h17" /><path d="m9 6.5 3-3 3 3M9 17.5l3 3 3-3M6.5 9l-3 3 3 3M17.5 9l3 3-3 3" /></>,
  more: <><circle cx="6" cy="12" r="1.1" /><circle cx="12" cy="12" r="1.1" /><circle cx="18" cy="12" r="1.1" /></>,
  minus: <path d="M6 12h12" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  magnet: <><path d="M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4z" /><path d="M6 8h4M14 8h4" /></>,
  expert: <><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /><path d="m13.5 4.5-3 15" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></>,
  grid: <><rect x="4" y="4" width="16" height="16" /><path d="M9.3 4v16M14.6 4v16M4 9.3h16M4 14.6h16" /></>,
};

/** the names of the icons (the UI audit checks every registry icon exists) */
export const ICON_NAMES: readonly string[] = Object.keys(P);

export function Icon({ name, size = 18, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={`hm-ico${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? P.box}
    </svg>
  );
}

/** icon for a room kind */
export const ROOM_ICON: Record<string, string> = { bath: 'bath', living: 'sofa', kitchen: 'kitchen', garage: 'garage', tech: 'box', hall: 'door', bed: 'bed', office: 'desk', storage: 'box', room: 'interior' };
