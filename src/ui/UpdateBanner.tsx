import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();
let needRefresh = false;

if (import.meta.env.PROD) {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() { needRefresh = true; listeners.forEach((l) => l()); },
    onRegisteredSW(_url, reg) {
      // Look for a newer version every 30 minutes while the app is open.
      if (reg) setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    },
  });
}

/** Shown when a newer version has been published. Never reloads on its own, so a live net is not interrupted. */
export default function UpdateBanner() {
  const [show, setShow] = useState(needRefresh);
  useEffect(() => { const l = () => setShow(true); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  if (!show) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of Net Control is available.</span>
      <button className="small primary" onClick={() => applyUpdate?.(true)}>Reload</button>
      <button className="small" onClick={() => setShow(false)}>Later</button>
    </div>
  );
}
