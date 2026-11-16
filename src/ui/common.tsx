import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../data/db';
import { groupRole } from '../data/services';
import { roleAllows, type Permission } from '../data/acl';
import type { GroupRole, ID, User } from '../data/types';

/* ---------- toasts ---------- */
interface Toast { id: number; text: string; error?: boolean }
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={'toast' + (t.error ? ' error' : '')}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an async action and report failures as a toast. Returns undefined on failure. */
export function useAction() {
  const toast = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      return undefined;
    }
  }, [toast]);
}

/* ---------- current user & permissions ---------- */
export function useCurrentUser(): User | undefined {
  return useLiveQuery(async () => {
    const id = await getMeta<string>('currentUserId');
    return id ? db.users.get(id) : undefined;
  });
}

export function useGroupRole(groupId: ID | undefined): GroupRole | null | undefined {
  return useLiveQuery(async () => (groupId ? groupRole(groupId) : null), [groupId]);
}

export function useCan(groupId: ID | undefined, perm: Permission): boolean {
  return roleAllows(useGroupRole(groupId), perm);
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="panel-header"><span className="panel-title">{title}</span><button className="icon" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="panel-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- confirm ---------- */
export function useConfirm() {
  return (msg: string) => window.confirm(msg);
}

/* ---------- clock ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
export function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="header-clock" title="Local time and UTC">
      <b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</b>
      <span>{pad(now.getUTCHours())}{pad(now.getUTCMinutes())}Z UTC</span>
    </div>
  );
}

/* ---------- misc ---------- */
export function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toUpperCase().indexOf(q.toUpperCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function useAutofocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

export const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const fmtDateTime = (iso: string) => (iso ? new Date(iso).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
