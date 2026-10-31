// The shell of a card (the properties of the selection, ADR 0040) shared by the furniture, door and stairs cards (Inspector.tsx)
// and the electrical device card (ElectricalPanels.tsx): one element, one test id, the same technical-data box in advanced mode.
import type { ReactNode } from 'react';

export function CardShell({ kind, className = '', children }: { kind: string; className?: string; children: ReactNode }) {
  return <aside className={`hm-inspector${className ? ` ${className}` : ''}`} data-testid="inspector" data-kind={kind}>{children}</aside>;
}

/** technical data (ids, coordinates, JSON) — the caller shows it only in advanced mode */
export function TechnicalData({ summary, children }: { summary: string; children: ReactNode }) {
  return <details className="hm-expert-box" data-testid="expert-details"><summary>{summary}</summary>{children}</details>;
}
