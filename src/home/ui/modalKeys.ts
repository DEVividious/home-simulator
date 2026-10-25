import type { KeyboardEvent } from 'react';

/**
 * Keys in a modal dialog: they do not leave the dialog (scene shortcuts — Delete, arrows, Q / E / R — do not act "under" it),
 * and Esc closes the dialog even when focus is inside it. Previously the dialog only stopped the event: after clicking any
 * switch in the dialog, Esc never reached the app shortcuts and the dialog stayed open.
 */
export const modalKeys = (close: () => void) => (e: KeyboardEvent) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
