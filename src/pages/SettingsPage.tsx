import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../data/db';
import { exportAll, restoreAll } from '../data/backup';
import { updateCurrentUser } from '../data/services';
import { downloadText } from '../lib/csv';
import { cleanCallInput } from '../lib/callsign';
import { fmtDateTime, useAction, useCurrentUser } from '../ui/common';

export default function SettingsPage() {
  const run = useAction();
  const user = useCurrentUser();
  const lastBackup = useLiveQuery(() => getMeta<string>('lastBackupAt'));
  const counts = useLiveQuery(async () => ({
    stations: (await db.stations.toArray()).filter((s) => !s.deletedAt).length,
    groups: (await db.groups.toArray()).filter((g) => !g.deletedAt).length,
    memberships: (await db.memberships.toArray()).filter((m) => !m.deletedAt).length,
  }));
  const auditRows = useLiveQuery(() => db.audit.orderBy('at').reverse().limit(100).toArray());
  const [name, setName] = useState('');
  const [call, setCall] = useState('');
  useEffect(() => { if (user) { setName(user.name); setCall(user.call); } }, [user?.id, user?.updatedAt]);

  const backup = async () => {
    const file = await exportAll();
    downloadText(`netcontrol-backup-${file.exportedAt.slice(0, 10)}.json`, JSON.stringify(file), 'application/json');
  };

  return (
    <>
      <div className="page-head"><div><div className="eyebrow">This browser</div><h1>Settings</h1></div></div>
      <div className="grid2">
        <div className="stack">
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Backup &amp; Restore</span></div>
            <div className="panel-body stack">
              <div className="muted">
                Everything is stored in this browser: {counts?.stations ?? 0} stations, {counts?.groups ?? 0} groups, {counts?.memberships ?? 0} memberships.
                Clearing browser data, or using another computer, starts empty. Keep a backup file somewhere safe.
              </div>
              <div>Last backup: {lastBackup ? <b>{fmtDateTime(lastBackup)}</b> : <span className="warn-text">never</span>}</div>
              <div className="row">
                <button className="primary" onClick={() => run(backup, 'Backup downloaded')}>Download Backup</button>
                <label className="btn" style={{ margin: 0, textTransform: 'none', letterSpacing: '.5px', fontSize: 12, color: 'var(--text)' }}>
                  Restore from File…
                  <input type="file" accept=".json,application/json" hidden onChange={async (e) => {
                    const f = e.target.files?.[0]; e.target.value = '';
                    if (!f) return;
                    if (!window.confirm('Restoring replaces everything in this browser with the backup. Continue?')) return;
                    await run(async () => { const r = await restoreAll(JSON.parse(await f.text())); return r; }, 'Backup restored');
                  }} />
                </label>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">You</span></div>
            <div className="panel-body stack">
              <div className="fields">
                <div><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><label>Call sign</label><input className="call-input" value={call} maxLength={8} onChange={(e) => setCall(cleanCallInput(e.target.value).replace('/', ''))} /></div>
              </div>
              <div className="row"><button className="primary" onClick={() => run(() => updateCurrentUser({ name, call }), 'Saved')}>Save</button></div>
              <div className="hint">{user?.isAdmin ? 'You are the Admin: you create groups, define positions, and manage who holds them. ' : ''}When member logins are added, this becomes your profile.</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Earlier Version</span></div>
            <div className="panel-body muted">
              Members from the single-page version were imported as groups on first run. Its session logs are kept and will be imported with nets.
              It is still available at <a href="./legacy/index.html">legacy/index.html</a>.
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><span className="panel-title">Change Log</span><span className="muted">last 100 changes</span></div>
          <div className="table-wrap" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <table><tbody>
              {(auditRows ?? []).map((a) => <tr key={a.id}><td className="muted" style={{ whiteSpace: 'nowrap', width: 150 }}>{fmtDateTime(a.at)}</td><td>{a.summary}</td></tr>)}
            </tbody></table>
            {!auditRows?.length && <div className="empty">No changes yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
