import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { initLang, t } from './i18n';
import { ErrorBoundary } from './home/ui/ErrorBoundary';
import { loadProject } from './project/registry';
import { initPwa } from './pwa/register';

// Project boundary: the project package (?project=<id> or the default of projects/index.json) is loaded, validated and
// activated BEFORE the app is imported — engine modules read building data only through project().
const App = lazy(async () => {
  const pkg = await loadProject();
  initLang(pkg.manifest.language);
  document.title = `${pkg.manifest.name} — Home Simulator`;
  return import('./home/HomeApp');
});

// start-up error boundary: a rejected project package or app code that failed to download would otherwise leave an empty
// page — the message gives the reason and "Reload". The app has its own boundary inside (it resumes without a reload).
initLang();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary homeLabel={t('app.reload')} onHome={() => window.location.reload()}>
      <Suspense fallback={<div className="status">{t('app.loading')}</div>}><App /></Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
// service worker (offline work, controlled updates)
void initPwa();
