import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './ui/common';
import { ensureLocalUser } from './data/services';
import { migrateLegacyIfNeeded } from './data/migrateLegacy';
import './styles.css';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    await ensureLocalUser();
    await migrateLegacyIfNeeded();
  } catch (e) {
    root.render(<div style={{ padding: 24, color: '#ff4444', fontFamily: 'monospace' }}>
      Could not open local storage: {e instanceof Error ? e.message : String(e)}. Private browsing windows may block it.
    </div>);
    return;
  }
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  root.render(
    <StrictMode>
      <HashRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </HashRouter>
    </StrictMode>,
  );
}

boot();
