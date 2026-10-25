// Application error boundary: an exception while rendering a panel or the scene must not leave a blank page. The message says
// the project is saved on the device and offers two ways out: back to the building view (no reload) or a page reload.
// React catching the exception is covered by the browser test; here — the state after the error, the message and the buttons.
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { ErrorBoundary } from '../ui/ErrorBoundary';

type El = ReactElement<{ children?: ReactNode; onClick?: () => void; 'data-testid'?: string }>;
const find = (n: ReactNode, id: string): El | null => {
  if (Array.isArray(n)) { for (const c of n) { const hit = find(c, id); if (hit) return hit; } return null; }
  if (!isValidElement(n)) return null;
  const e = n as El;
  return e.props['data-testid'] === id ? e : find(e.props.children, id);
};
const HOME = 'Back to the apartment view', CAUSE = 'the project has no element entry';
/** boundary after a caught error (React sets the state from getDerivedStateFromError) */
function caught(onHome = () => {}) {
  const b = new ErrorBoundary({ children: createElement('p', null, 'application'), homeLabel: HOME, onHome });
  const reset = vi.fn();
  b.setState = reset as never;
  b.state = ErrorBoundary.getDerivedStateFromError(new Error(CAUSE));
  return { b, reset };
}
afterEach(() => vi.unstubAllGlobals());

describe('application error boundary', () => {
  it('without an error renders the application', () => {
    expect(renderToStaticMarkup(createElement(ErrorBoundary, { homeLabel: HOME, onHome: () => {} }, createElement('p', null, 'application')))).toBe('<p>application</p>');
  });
  it('after an error: message (project saved on the device), the cause and two buttons — instead of a blank page', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x')).error?.message).toBe('x');
    const html = renderToStaticMarkup(caught().b.render() as ReactElement);
    expect(html).toContain('data-testid="app-error"');
    expect(html).toContain(t('errorUi.title'));
    expect(html).toContain(t('errorUi.safe'));
    expect(html).toContain(t('errorUi.cause', { message: CAUSE }));
    expect(html).toMatch(new RegExp(`data-testid="app-error-home"[^>]*>${HOME}<`));
    expect(html).toMatch(new RegExp(`data-testid="app-error-reload"[^>]*>${t('errorUi.reload')}<`));
    expect(html).not.toContain('application');
  });
  it('"Back to the … view": tidies the UI state (selection) first, then resumes the application — no reload', () => {
    const order: string[] = [], { b, reset } = caught(() => order.push('ui state'));
    reset.mockImplementation(() => order.push('resume'));
    find(b.render(), 'app-error-home')!.props.onClick!();
    expect(order).toEqual(['ui state', 'resume']);
    expect(reset).toHaveBeenCalledWith({ error: null });
  });
  it('"Reload" reloads the page', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    find(caught().b.render(), 'app-error-reload')!.props.onClick!();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
