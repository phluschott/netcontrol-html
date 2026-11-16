import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, live } from '../data/db';
import { useDirectory, hasPerm, searchStations, stationLocation, distinctOnAirName } from '../data/queries';
import {
  addVisitorsToGroup, callQueue, deleteCheckin, deleteSession, endSession, lateCheckIn, reopenSession, sessionCounts, setCheckinStatus,
} from '../data/nets';
import { CHECKIN_STATUS_LABEL, type Checkin, type CheckinStatus, type Station } from '../data/types';
import { baseCall, callError, cleanCallInput } from '../lib/callsign';
import { downloadText, toCsv } from '../lib/csv';
import { Highlight, fmtDate, useAction, useToast } from '../ui/common';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const STATUS_CHIP: Record<CheckinStatus, string> = { pending: 'dim', checked_in: 'green', absent: '', skipped: 'yellow', sk: 'dim' };

type Tab = 'missing' | 'in' | 'log';

export default function NetPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const run = useAction();
  const toast = useToast();
  const dir = useDirectory();
  const data = useLiveQuery(async () => {
    const session = await db.sessions.get(id);
    if (!session || session.deletedAt) return { session: null, rows: [] as Checkin[] };
    return { session, rows: live(await db.checkins.where('sessionId').equals(id).toArray()) };
  }, [id]);
  const [tab, setTab] = useState<Tab>('missing');
  const [undo, setUndo] = useState<Checkin[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const lateRef = useRef<HTMLInputElement>(null);

  const session = data?.session;
  const rows = data?.rows ?? [];
  const queue = useMemo(() => callQueue(rows), [rows]);
  const current = queue[0];
  const stationById = useMemo(() => new Map((dir?.stations ?? []).map((s) => [s.id, s])), [dir]);
  const live_ = !!session && !session.endedAt;
  const canRun = !!session && !!dir && hasPerm(dir, session.groupId, 'nets.run');
  const canEditLog = !!session && !!dir && hasPerm(dir, session.groupId, 'nets.editLog');
  const canChange = live_ ? canRun : canEditLog;

  const mark = async (status: CheckinStatus) => {
    if (!current || !canChange) return;
    if (status === 'sk' && !window.confirm(`Record ${current.call} as Silent Key? The station will be marked Silent Key in the directory and will not be called in future nets.`)) return;
    const before = current;
    const r = await run(() => setCheckinStatus(before.id, status));
    if (r) setUndo((u) => [...u.slice(-49), before]);
  };
  const undoLast = async () => {
    const prev = undo[undo.length - 1];
    if (!prev) return;
    const r = await run(() => setCheckinStatus(prev.id, prev.status, { order: prev.order, skips: prev.skips, late: prev.late, statusAt: prev.statusAt }), `Undid ${prev.call}`);
    if (r) setUndo((u) => u.slice(0, -1));
  };

  // Keyboard: C / A / S / K mark the station being called; U undoes; / jumps to late check-in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? '')) return;
      const k = e.key.toLowerCase();
      const map: Record<string, CheckinStatus> = { c: 'checked_in', a: 'absent', s: 'skipped', k: 'sk' };
      if (map[k] && current && live_) { e.preventDefault(); mark(map[k]); }
      else if (k === 'u') { e.preventDefault(); undoLast(); }
      else if (k === '/') { e.preventDefault(); lateRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!data || !dir) return null;
  if (!session) return <div className="panel"><div className="empty">Net not found. <Link to="/groups">Back to groups</Link></div></div>;
  const group = dir.groupById.get(session.groupId);
  const counts = sessionCounts(rows);
  const called = counts.total - counts.pending - counts.skipped;
  const elapsed = Math.max(0, Math.floor(((session.endedAt ? new Date(session.endedAt).getTime() : now) - new Date(session.startedAt).getTime()) / 1000));
  const elapsedText = elapsed >= 3600 ? `${Math.floor(elapsed / 3600)}:${pad(Math.floor(elapsed % 3600 / 60))}:${pad(elapsed % 60)}` : `${Math.floor(elapsed / 60)}:${pad(elapsed % 60)}`;
  const missing = rows.filter((r) => r.status !== 'checked_in' && r.status !== 'sk').sort((a, b) => a.call.localeCompare(b.call));
  const checkedIn = rows.filter((r) => r.status === 'checked_in').sort((a, b) => (a.statusAt ?? '').localeCompare(b.statusAt ?? ''));
  const st = current && stationById.get(current.stationId);
  const visitors = checkedIn.filter((r) => r.visitor && !dir.membershipsByStation.get(r.stationId)?.some((m) => m.groupId === session.groupId));

  const exportCsv = () => downloadText(`${session.title.replace(/\W+/g, '_')}_${session.startedAt.slice(0, 10)}.csv`, toCsv([
    ['Net', session.title], ['Group', group?.name ?? ''], ['Date', fmtDate(session.startedAt)], ['Started', hhmm(session.startedAt)], ['Ended', hhmm(session.endedAt)], ['Net control', session.ncsCall],
    ['Checked in', counts.checkedIn], ['Late', counts.late], ['Visitors', counts.visitors], ['Absent', counts.absent], [],
    ['Call', 'Name', 'Status', 'Time', 'Late', 'Visitor', 'Skipped'],
    ...rows.slice().sort((a, b) => a.call.localeCompare(b.call)).map((r) => {
      const s = stationById.get(r.stationId);
      return [r.call, s?.name ?? '', CHECKIN_STATUS_LABEL[r.status], hhmm(r.statusAt), r.late ? 'yes' : '', r.visitor ? 'yes' : '', r.skips || ''];
    }),
  ]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link to="/groups">Groups</Link> / {group ? <Link to={`/groups/${group.id}`}>{group.name}</Link> : 'Group'} /</div>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h1>{session.title}</h1>
            {live_ ? <span className="chip green">● Live</span> : <span className="chip dim">Ended</span>}
          </div>
          <div className="muted">{fmtDate(session.startedAt)} · started {hhmm(session.startedAt)}{session.endedAt && ` · ended ${hhmm(session.endedAt)}`}{session.ncsCall && ` · NCS ${session.ncsCall}`}</div>
        </div>
        <div className="row">
          <div className="counts">
            <div><b className="ok">{counts.checkedIn}</b><span>Checked in</span></div>
            <div><b>{counts.absent}</b><span>Absent</span></div>
            <div><b>{counts.pending + counts.skipped}</b><span>To call</span></div>
            <div><b>{counts.late}</b><span>Late</span></div>
            <div><b>{elapsedText}</b><span>Elapsed</span></div>
          </div>
          <button onClick={exportCsv}>Export CSV</button>
          {live_ && canRun && <button className="danger" onClick={async () => {
            const open = counts.pending + counts.skipped;
            if (!window.confirm(`End ${session.title}?${open ? `\n\n${open} station(s) not yet answered will be recorded Absent.` : ''}`)) return;
            await run(() => endSession(session.id), 'Net ended');
          }}>End Net</button>}
          {!live_ && canEditLog && <button onClick={() => run(() => reopenSession(session.id), 'Net reopened')}>Reopen</button>}
          {!live_ && canEditLog && <button className="danger" onClick={async () => {
            if (!window.confirm(`Delete ${session.title} and its whole log? This cannot be undone.`)) return;
            if (await run(() => deleteSession(session.id).then(() => true), 'Net deleted')) nav(`/groups/${session.groupId}`);
          }}>Delete</button>}
        </div>
      </div>

      <div className="grid-side" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,420px)' }}>
        <div className="stack">
          {live_ && current && st && (
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Now Calling</span>
                <span className="muted">{called + 1} of {counts.total}{current.skips > 0 && <span className="chip yellow" style={{ marginLeft: 8 }}>Skipped {current.skips > 1 ? `${current.skips}×` : 'once'}</span>}</span>
              </div>
              <div className="panel-body" style={{ padding: 18 }}>
                <div className="row" style={{ alignItems: 'baseline', gap: 18 }}>
                  <span style={{ fontSize: 54, fontWeight: 800, letterSpacing: 6, lineHeight: 1 }}>{current.call}</span>
                  <span style={{ fontSize: 18 }}>{st.name}{distinctOnAirName(st) && <span className="muted"> “{distinctOnAirName(st)}”</span>}</span>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>{stationLocation(st)}</div>
                {st.notes && <div className="warn-text pre" style={{ marginTop: 8 }}>{st.notes}</div>}
                {canRun ? (
                  <div className="call-buttons">
                    <button className="cb checkin" onClick={() => mark('checked_in')}>Checked In<kbd>C</kbd></button>
                    <button className="cb" onClick={() => mark('absent')}>Absent<kbd>A</kbd></button>
                    <button className="cb skip" onClick={() => mark('skipped')}>Skip<kbd>S</kbd></button>
                    <button className="cb sk" onClick={() => mark('sk')}>Silent Key<kbd>K</kbd></button>
                  </div>
                ) : <div className="muted" style={{ marginTop: 14 }}>Your position can view this net but not run it.</div>}
                <div className="row between" style={{ marginTop: 12 }}>
                  <span className="muted">Up next: {queue.slice(1, 6).map((r) => r.call).join(' · ') || 'end of list'}</span>
                  {canRun && <button className="small" disabled={!undo.length} onClick={undoLast}>Undo {undo.length ? undo[undo.length - 1].call : ''} <kbd>U</kbd></button>}
                </div>
              </div>
            </div>
          )}

          {live_ && !current && (
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Roll Call Complete</span></div>
              <div className="panel-body">
                <div style={{ fontSize: 15 }}>Ask for late check-ins and anyone who missed their call.</div>
                <div className="muted" style={{ marginTop: 4 }}>Type a call below, or pick from the <b>Not Checked In</b> list. End the net when done.</div>
                {canRun && <div className="row" style={{ marginTop: 10 }}><button className="small" disabled={!undo.length} onClick={undoLast}>Undo {undo.length ? undo[undo.length - 1].call : ''} <kbd>U</kbd></button></div>}
              </div>
            </div>
          )}

          {canChange && (
            <LateCheckIn inputRef={lateRef} rows={rows} stations={dir.stations} highlight={!current}
              onCheckIn={async (call) => {
                const r = await run(() => lateCheckIn(session.id, call));
                if (r) toast(`${r.call} checked in at ${hhmm(r.statusAt)}${r.visitor ? ' (visitor)' : r.late ? ' (late)' : ''}`);
                return !!r;
              }} />
          )}

          {!live_ && (
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Summary</span></div>
              <div className="panel-body stack">
                <div>{counts.checkedIn} checked in ({counts.late} late, {counts.visitors} visitor{counts.visitors === 1 ? '' : 's'}) · {counts.absent} absent{counts.sk ? ` · ${counts.sk} Silent Key` : ''} · {elapsedText} on the air.</div>
                {visitors.length > 0 && dir && hasPerm(dir, session.groupId, 'members.manage') && <VisitorsBlock rows={visitors} stationById={stationById} groupName={group?.name ?? 'the group'} onAdd={(ids) => run(() => addVisitorsToGroup(session.id, ids), 'Added to the group')} />}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="tabs" style={{ padding: '0 10px', margin: 0, background: 'var(--ov1)', minHeight: 34 }}>
            <button className={tab === 'missing' ? 'on' : ''} onClick={() => setTab('missing')}>Not Checked In <span className="panel-count">{missing.length}</span></button>
            <button className={tab === 'in' ? 'on' : ''} onClick={() => setTab('in')}>Checked In <span className="panel-count">{checkedIn.length}</span></button>
            <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Log</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
            <table><tbody>
              {tab === 'missing' && missing.map((r) => (
                <tr key={r.id}>
                  <td className="call">{r.call}</td>
                  <td className="muted">{stationById.get(r.stationId)?.name}</td>
                  <td><span className={'chip ' + STATUS_CHIP[r.status]}>{r.status === 'pending' ? 'Not called' : CHECKIN_STATUS_LABEL[r.status]}</span></td>
                  <td className="actions">{canChange && <button className="small primary" onClick={async () => {
                    const x = await run(() => lateCheckIn(session.id, r.call));
                    if (x) toast(`${x.call} checked in at ${hhmm(x.statusAt)}${x.late ? ' (late)' : ''}`);
                  }}>Check In</button>}</td>
                </tr>
              ))}
              {tab === 'in' && checkedIn.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ color: 'var(--green3)', width: 56 }}>{hhmm(r.statusAt)}</td>
                  <td className="call">{r.call}</td>
                  <td className="muted">{stationById.get(r.stationId)?.name}</td>
                  <td className="actions">{r.late && <span className="chip yellow">Late</span>} {r.visitor && <span className="chip cyan">Visitor</span>}</td>
                </tr>
              ))}
              {tab === 'log' && rows.slice().sort((a, b) => (b.statusAt ?? '').localeCompare(a.statusAt ?? '') || a.order - b.order).map((r) => (
                <tr key={r.id}>
                  <td className="mono muted" style={{ width: 56 }}>{hhmm(r.statusAt)}</td>
                  <td className="call">{r.call}</td>
                  <td>
                    {canChange
                      ? <select value={r.status} style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }} onChange={(e) => {
                          const v = e.target.value as CheckinStatus;
                          if (v === 'sk' && !window.confirm(`Record ${r.call} as Silent Key?`)) return;
                          run(() => setCheckinStatus(r.id, v));
                        }}>
                          {(Object.keys(CHECKIN_STATUS_LABEL) as CheckinStatus[]).map((k) => <option key={k} value={k}>{CHECKIN_STATUS_LABEL[k]}</option>)}
                        </select>
                      : <span className={'chip ' + STATUS_CHIP[r.status]}>{CHECKIN_STATUS_LABEL[r.status]}</span>}
                    {r.late && <span className="chip yellow" style={{ marginLeft: 4 }}>Late</span>}{r.visitor && <span className="chip cyan" style={{ marginLeft: 4 }}>Visitor</span>}
                  </td>
                  <td className="actions">{canEditLog && <button className="icon" title="Delete from the log" onClick={() => window.confirm(`Delete ${r.call} from this net's log?`) && run(() => deleteCheckin(r.id), `${r.call} removed`)}>✕</button>}</td>
                </tr>
              ))}
            </tbody></table>
            {tab === 'missing' && !missing.length && <div className="empty">Everyone on the roll is checked in.</div>}
            {tab === 'in' && !checkedIn.length && <div className="empty">No one checked in yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

/** Type a call: matches this net's stations not yet checked in first, then the directory; a new call becomes a visitor. */
function LateCheckIn({ rows, stations, onCheckIn, inputRef, highlight }: {
  rows: Checkin[]; stations: Station[]; onCheckIn: (call: string) => Promise<boolean>;
  inputRef: React.RefObject<HTMLInputElement>; highlight: boolean;
}) {
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const [err, setErr] = useState('');
  const items = useMemo(() => {
    const query = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!query) return [];
    const inNet = new Map(rows.map((r) => [r.stationId, r]));
    const ranked = searchStations(stations.filter((s) => inNet.get(s.id)?.status !== 'checked_in'), query, 20)
      .map(({ station, rank }) => ({ station, rank, row: inNet.get(station.id) }))
      .sort((a, b) => Number(!a.row) - Number(!b.row) || a.rank - b.rank || a.station.call.localeCompare(b.station.call))
      .slice(0, 8);
    const out: { call: string; label: string; kind: 'roll' | 'visitor' | 'new' }[] = ranked.map(({ station, row }) => ({
      call: station.call, label: [station.name, stationLocation(station)].filter(Boolean).join(' · '), kind: row ? 'roll' : 'visitor',
    }));
    const base = baseCall(q);
    if (!callError(base) && !out.some((o) => o.call === base) && !stations.some((s) => s.call === base || s.previousCalls.includes(base))) out.push({ call: base, label: 'New station: added to the directory as a visitor', kind: 'new' });
    return out;
  }, [q, rows, stations]);
  useEffect(() => { setAct(0); }, [q]);
  const pick = async (call: string) => {
    if (await onCheckIn(call)) { setQ(''); setErr(''); inputRef.current?.focus(); }
  };
  const submit = () => {
    if (items[act]) return pick(items[act].call);
    const base = baseCall(q);
    const e = callError(base);
    if (e) { setErr(e); return; }
    pick(base);
  };
  return (
    <div className="panel" style={highlight ? { borderColor: 'var(--green-bd)' } : undefined}>
      <div className="panel-header"><span className="panel-title">Late Check-in / Missed Call</span><span className="muted"><kbd>/</kbd> to jump here</span></div>
      <div className="panel-body">
        <input ref={inputRef} className="call-input" style={{ fontSize: 20, padding: 10 }} value={q} placeholder="Type a call sign (prefix or suffix)…" autoFocus={highlight}
          onChange={(e) => { setQ(cleanCallInput(e.target.value)); setErr(''); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAct((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAct((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur(); }
          }} />
        <div className="err">{err}</div>
        {items.length > 0 && (
          <div className="palette-list" style={{ border: '1px solid var(--border)', maxHeight: 280 }}>
            {items.map((it, i) => (
              <div key={it.call} className={'palette-item' + (i === act ? ' act' : '')} onMouseEnter={() => setAct(i)} onClick={() => pick(it.call)}>
                <span className="call" style={{ minWidth: 90 }}><Highlight text={it.call} q={q.toUpperCase().replace(/[^A-Z0-9]/g, '')} /></span>
                <span className="muted" style={{ flex: 1 }}>{it.label}</span>
                {it.kind !== 'roll' && <span className="chip cyan">Visitor</span>}
              </div>
            ))}
          </div>
        )}
        <div className="hint"><kbd>Enter</kbd> checks in the highlighted station · <kbd>↑</kbd><kbd>↓</kbd> to choose</div>
      </div>
    </div>
  );
}

function VisitorsBlock({ rows, stationById, groupName, onAdd }: { rows: Checkin[]; stationById: Map<string, Station>; groupName: string; onAdd: (ids: string[]) => Promise<unknown> }) {
  const [sel, setSel] = useState<Set<string>>(new Set(rows.map((r) => r.stationId)));
  return (
    <div>
      <div className="label">Visitors who checked in</div>
      {rows.map((r) => (
        <label key={r.id} className="check" style={{ display: 'flex', margin: '4px 0' }}>
          <input type="checkbox" checked={sel.has(r.stationId)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.stationId); else n.delete(r.stationId); setSel(n); }} />
          <b>{r.call}</b> <span className="muted">{stationById.get(r.stationId)?.name}</span>
        </label>
      ))}
      <button className="small primary" disabled={!sel.size} onClick={() => onAdd([...sel])}>Add {sel.size} to {groupName}</button>
    </div>
  );
}
