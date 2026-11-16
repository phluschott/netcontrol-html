import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, live } from '../data/db';
import { hasPerm, type Directory } from '../data/queries';
import { sessionCounts, startRollCall } from '../data/nets';
import { Modal, fmtDate, useAction, useCurrentUser } from '../ui/common';
import type { Group } from '../data/types';

/** Group page panel: start a roll call net, resume the live one, and past nets. */
export default function NetsPanel({ group, dir }: { group: Group; dir: Directory }) {
  const nav = useNavigate();
  const run = useAction();
  const user = useCurrentUser();
  const [starting, setStarting] = useState(false);
  const sessions = useLiveQuery(async () => {
    const ss = live(await db.sessions.where('groupId').equals(group.id).toArray()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const withCounts = await Promise.all(ss.slice(0, 25).map(async (s) => ({ s, c: sessionCounts(live(await db.checkins.where('sessionId').equals(s.id).toArray())) })));
    return withCounts;
  }, [group.id]);
  const canRun = hasPerm(dir, group.id, 'nets.run');
  const canSee = hasPerm(dir, group.id, 'nets.history');
  const running = sessions?.find((x) => !x.s.endedAt);
  const onRoll = (dir.membershipsByGroup.get(group.id) ?? []).filter((m) => m.active).length;

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Nets</span>
        {canRun && !running && <button className="small primary" onClick={() => setStarting(true)}>▶ Start Net</button>}
      </div>
      <div className="panel-body stack">
        {running && (
          <Link to={`/nets/${running.s.id}`} className="btn live" style={{ justifyContent: 'center' }}>● Resume live net: {running.c.checkedIn} checked in</Link>
        )}
        {canSee && sessions && sessions.filter((x) => x.s.endedAt).slice(0, 8).map(({ s, c }) => (
          <div key={s.id} className="row between" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
            <Link to={`/nets/${s.id}`}>{fmtDate(s.startedAt)}</Link>
            <span className="muted">{c.checkedIn} in · {c.absent} absent</span>
          </div>
        ))}
        {canSee && sessions && !sessions.length && <div className="muted">No nets yet.{canRun && ' Start one to run the roll call.'}</div>}
        {!canSee && <div className="muted">Your position does not include net history.</div>}
      </div>
      {starting && (
        <StartNetModal groupName={group.name} onRoll={onRoll} defaultCall={user?.call ?? ''} onClose={() => setStarting(false)}
          onStart={async (title, ncsCall) => {
            const s = await run(() => startRollCall(group.id, { title, ncsCall }));
            if (s) nav(`/nets/${s.id}`);
          }} />
      )}
    </div>
  );
}

function StartNetModal({ groupName, onRoll, defaultCall, onStart, onClose }: { groupName: string; onRoll: number; defaultCall: string; onStart: (title: string, ncs: string) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState(`${groupName} Net`);
  const [ncs, setNcs] = useState(defaultCall);
  return (
    <Modal title="Start Roll Call Net" onClose={onClose} footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onStart(title, ncs)}>▶ Start Net</button></>}>
      <div className="stack">
        <div className="fields">
          <div className="full"><label>Net name</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label>Net control call sign</label><input className="call-input" value={ncs} maxLength={8} placeholder="e.g., K9TWX" onChange={(e) => setNcs(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></div>
        </div>
        <div className="muted">{onRoll} active member{onRoll === 1 ? '' : 's'} will be called in alphabetical order. Inactive members and Silent Key stations are left off.</div>
      </div>
    </Modal>
  );
}
