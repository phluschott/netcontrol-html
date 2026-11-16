import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMeta } from '../data/db';
import { backupHistory, createEncryptedBackup, inspectBackupText, restoreFromText } from '../data/backup';
import { downloadText } from '../lib/csv';
import { normalizePassword, WrongPasswordError } from '../lib/crypto';
import { Modal, fmtDateTime, useToast } from '../ui/common';

/** Encrypted backup download, restore with password, and this browser's list of past backups. */
export default function BackupPanel({ summary }: { summary: string }) {
  const toast = useToast();
  const lastBackup = useLiveQuery(() => getMeta<string>('lastBackupAt'));
  const history = useLiveQuery(backupHistory) ?? [];
  const [made, setMade] = useState<{ fileName: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<{ text: string; fileName: string; encrypted: boolean; id?: string; createdAt: string } | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());

  const download = async () => {
    setBusy(true);
    try {
      const b = await createEncryptedBackup();
      downloadText(b.fileName, b.text, 'application/json');
      setMade({ fileName: b.fileName, password: b.password });
    } catch (e) { toast(e instanceof Error ? e.message : String(e), true); }
    setBusy(false);
  };

  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Backup &amp; Restore</span></div>
      <div className="panel-body stack">
        <div className="muted">{summary} Clearing browser data, or using another computer, starts empty. Keep a backup file somewhere safe.</div>
        <div>Last backup: {lastBackup ? <b>{fmtDateTime(lastBackup)}</b> : <span className="warn-text">never</span>}</div>
        <div className="row">
          <button className="primary" disabled={busy} onClick={download}>{busy ? 'Encrypting…' : 'Download Encrypted Backup'}</button>
          <label className="btn" style={{ margin: 0, textTransform: 'none', letterSpacing: '.5px', fontSize: 12, color: 'var(--text)' }}>
            Restore from File…
            <input type="file" accept=".ncbackup,.json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = '';
              if (!f) return;
              try {
                const text = await f.text();
                const info = inspectBackupText(text);
                setRestoring({ text, fileName: f.name, ...info });
              } catch (x) { toast(x instanceof Error ? x.message : String(x), true); }
            }} />
          </label>
        </div>
        <div className="hint">
          Every backup is encrypted with its own generated password. To share data with another net controller, send the file one way
          (email, USB) and the password another way (phone call, text). Do not read the password over the air.
        </div>

        {history.length > 0 && (
          <div>
            <div className="label">Backups made in this browser</div>
            <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table><tbody>
                {history.map((h) => (
                  <tr key={h.id + h.createdAt}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(h.createdAt)}</td>
                    <td className="muted">{h.fileName}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                      {shown.has(h.id) ? h.password : '••••-••••-••••-••••-••••'}
                    </td>
                    <td className="actions">
                      {shown.has(h.id)
                        ? <button className="small" onClick={() => navigator.clipboard?.writeText(h.password).then(() => toast('Password copied'))}>Copy</button>
                        : <button className="small" onClick={() => setShown(new Set([...shown, h.id]))}>Show</button>}
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="hint">Passwords are kept only in this browser so you can look them up later. The file name ends with the same 4-character code as its entry here.</div>
          </div>
        )}
      </div>

      {made && (
        <Modal title="Backup Downloaded" onClose={() => setMade(null)} footer={<button className="primary" onClick={() => setMade(null)}>Done</button>}>
          <div className="stack">
            <div className="muted">{made.fileName}</div>
            <div>This file can only be opened with this password:</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2, padding: '12px 14px', border: '1px solid var(--green-bd)', background: 'var(--green-bg)', color: 'var(--green3)', textAlign: 'center' }}>
              {made.password}
            </div>
            <div className="row">
              <button onClick={() => navigator.clipboard?.writeText(made.password).then(() => toast('Password copied'), () => toast('Copy failed; write it down instead', true))}>Copy Password</button>
            </div>
            <div className="hint">It is also listed under “Backups made in this browser”. If this browser's data is lost, the password is lost with it, so keep a copy somewhere else too.</div>
          </div>
        </Modal>
      )}

      {restoring && <RestoreModal info={restoring} onClose={() => setRestoring(null)} onDone={(msg) => { toast(msg); setRestoring(null); }} />}
    </div>
  );
}

function RestoreModal({ info, onClose, onDone }: {
  info: { text: string; fileName: string; encrypted: boolean; id?: string; createdAt: string };
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (info.encrypted && normalizePassword(password).replace(/-/g, '').length < 20) { setErr('The password is 20 characters.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await restoreFromText(info.text, password);
      onDone(`Restored ${r.stations} stations, ${r.groups} groups, ${r.memberships} memberships`);
    } catch (e) {
      setErr(e instanceof WrongPasswordError ? e.message : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Restore Backup" onClose={onClose}
      footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="danger" disabled={busy} onClick={submit}>{busy ? 'Restoring…' : 'Replace Everything & Restore'}</button></>}>
      <div className="stack">
        <div><b>{info.fileName}</b><div className="muted">Made {fmtDateTime(info.createdAt)}{info.id && ` · code ${info.id}`}{!info.encrypted && ' · not encrypted (older backup)'}</div></div>
        {info.encrypted && (
          <div>
            <label>Password</label>
            <input className="mono" autoFocus value={password} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" style={{ fontSize: 16, letterSpacing: 2 }}
              onChange={(e) => { setPassword(normalizePassword(e.target.value)); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            <div className="hint">Dashes and capitals are optional.</div>
          </div>
        )}
        <div className="warn-text">Restoring replaces everything in this browser with the backup. Download a backup of this browser first if you need to keep it.</div>
      </div>
    </Modal>
  );
}
