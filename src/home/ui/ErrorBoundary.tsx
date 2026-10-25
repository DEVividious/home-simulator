// Application error boundary: an exception while rendering a panel or the scene unmounts the whole React tree — without a
// boundary a blank page is left. Instead: a short message and two ways out. The project is safe — the working copy is written to
// the device on every change (configurator/store.ts: writeLocal), and the state stores live outside the React tree, so returning
// to the building view resumes work without a reload (undo history included). A class component: only those catch render
// errors; React itself logs the error to the console. Strings are translated in render() only — never at module load.
import { Component, type ReactNode } from 'react';
import { t } from '../../i18n';

interface Props {
  children?: ReactNode;
  /** label of the return button ("Back to the house view" / "… apartment view") */
  homeLabel: string;
  /** tidies the UI state before resuming: selection and open views where the error may have occurred */
  onHome: () => void;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // class "hm": the app's colour variables and typeface (hm-btn buttons use them) — the message replaces the app root
    // class "app-error" (styles.css): message layout where the Home stylesheet is not loaded (tool pages, start-up)
    return (
      <div className="hm hm-status app-error" role="alert" data-testid="app-error" style={{ color: 'var(--hm-ink)', padding: '0 24px', textAlign: 'center' }}>
        <b>{t('errorUi.title')}</b>
        <span>{t('errorUi.safe')}</span>
        <div className="hm-btn-row" style={{ justifyContent: 'center' }}>
          <button className="hm-btn primary" onClick={() => { this.props.onHome(); this.setState({ error: null }); }} data-testid="app-error-home">{this.props.homeLabel}</button>
          <button className="hm-btn" onClick={() => window.location.reload()} data-testid="app-error-reload">{t('errorUi.reload')}</button>
        </div>
        <small className="hm-muted" data-testid="app-error-cause">{t('errorUi.cause', { message: error.message })}</small>
      </div>
    );
  }
}
