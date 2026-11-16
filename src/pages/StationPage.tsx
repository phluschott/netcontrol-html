import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../data/db';
import { useDirectory, stationLocation, distinctOnAirName } from '../data/queries';
import {
  addMembership, canEditStation, deleteStation, emptyMembership, findStationByCall, removeMembership, updateMembership, updateStation,
} from '../data/services';
import { roleAllows } from '../data/acl';
import { GROUP_TYPE_LABEL, STATION_STATUS_LABEL, type Membership } from '../data/types';
import { MembershipModal, RoleChips, StationFormModal } from '../ui/forms';
import { fmtDate, fmtDateTime, useAction } from '../ui/common';

export default function StationPage() {
  const { call = '' } = useParams();
  const nav = useNavigate();
  const run = useAction();
  const dir = useDirectory();
  const hit = useLiveQuery(() => findStationByCall(call), [call]);
  const station = hit?.station;
  const canEdit = useLiveQuery(async () => (station ? canEditStation(station.id) : false), [station?.id, station?.updatedAt]);
  const history = useLiveQuery(async () => {
    if (!station) return [];
    const ms = await db.memberships.where('stationId').equals(station.id).toArray();
    const keys: [string, string][] = [['station', station.id], ...ms.map((m) => ['membership', m.id] as [string, string])];
    const rows = (await Promise.all(keys.map((k) => db.audit.where('[entity+entityId]').equals(k).toArray()))).flat();
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  }, [station?.id, station?.updatedAt]);

  const [editing, setEditing] = useState(false);
  const [editingM, setEditingM] = useState<Membership | null>(null);
  const [notes, setNotes] = useState('');
  const [joinGroup, setJoinGroup] = useState('');
  useEffect(() => { setNotes(station?.notes ?? ''); }, [station?.id, station?.notes]);

  // Opened under a previous call sign: show the station under its current call.
  useEffect(() => { if (hit?.viaPrevious) nav(`/stations/${hit.station.call}`, { replace: true }); }, [hit, nav]);

  if (hit === undefined || !dir) return null;
  if (!station) {
    return (
      <div className="panel"><div className="empty">
        <p>{call.toUpperCase()} is not in the station directory.</p>
        <Link to="/stations">Back to stations</Link>
      </div></div>
    );
  }

  const memberships = (dir.membershipsByStation.get(station.id) ?? []).slice().sort((a, b) => (dir.groupById.get(a.groupId)?.name ?? '').localeCompare(dir.groupById.get(b.groupId)?.name ?? ''));
  const joinable = dir.groups.filter((g) => roleAllows(dir.roleByGroup.get(g.id), 'members.manage') && !memberships.some((m) => m.groupId === g.id));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link to="/stations">Stations</Link> /</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 14 }}>
            <span className="big-call">{station.call}</span>
            <span style={{ fontSize: 15 }}>{station.name || station.onAirName}{distinctOnAirName(station) && <span className="muted"> “{distinctOnAirName(station)}”</span>}</span>
            <span className={'chip ' + (station.status === 'active' ? 'green' : station.status === 'sk' ? '' : 'dim')}>{STATION_STATUS_LABEL[station.status]}</span>
          </div>
          <div className="muted">{stationLocation(station) || 'No location on file'}{station.grid && ` · ${station.grid}`}{station.previousCalls.length > 0 && ` · previously ${station.previousCalls.join(', ')}`}</div>
        </div>
        {canEdit && (
          <div className="row">
            <button onClick={() => setEditing(true)}>Edit Station</button>
            <button className="danger" onClick={async () => {
              if (!window.confirm(`Delete ${station.call} from the directory?`)) return;
              if (await run(() => deleteStation(station.id).then(() => true), `${station.call} deleted`)) nav('/stations');
            }}>Delete</button>
          </div>
        )}
      </div>

      <div className="grid-side">
        <div className="stack">
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Standing Notes</span>{canEdit && notes !== station.notes && <button className="small primary" onClick={() => run(() => updateStation(station.id, { notes }), 'Notes saved')}>Save</button>}</div>
            <div className="panel-body">
              {canEdit
                ? <textarea rows={4} value={notes} placeholder="True every week: mobile most Tuesdays, relays via K9XYZ…" onChange={(e) => setNotes(e.target.value)} />
                : <div className="pre">{station.notes || <span className="muted">None</span>}</div>}
              <div className="hint">Shown to net control whenever this station checks in.</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Details</span></div>
            <div className="panel-body">
              <dl className="dl">
                <dt>Name</dt><dd>{station.name || '–'}</dd>
                <dt>On-air name</dt><dd>{station.onAirName || '–'}</dd>
                <dt>City</dt><dd>{station.city || '–'}</dd>
                <dt>County</dt><dd>{station.county || '–'}</dd>
                <dt>State</dt><dd>{station.state || '–'}</dd>
                <dt>Grid</dt><dd>{station.grid || '–'}</dd>
                <dt>Added</dt><dd>{fmtDate(station.createdAt)}</dd>
                <dt>Updated</dt><dd>{fmtDateTime(station.updatedAt)}</dd>
              </dl>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Groups<span className="panel-count">{memberships.length}</span></span>
              {joinable.length > 0 && (
                <div className="row">
                  <select value={joinGroup} onChange={(e) => setJoinGroup(e.target.value)} style={{ width: 'auto', padding: '3px 6px' }}>
                    <option value="">Add to group…</option>
                    {joinable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <button className="small primary" disabled={!joinGroup} onClick={async () => {
                    const g = dir.groupById.get(joinGroup);
                    await run(() => addMembership(joinGroup, station.id), `${station.call} added to ${g?.name}`);
                    setJoinGroup('');
                  }}>Add</button>
                </div>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Group</th><th>Type</th><th>Roles</th><th>Spotter ID</th><th>Joined</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {memberships.map((m) => {
                    const g = dir.groupById.get(m.groupId)!;
                    const manage = roleAllows(dir.roleByGroup.get(g.id), 'members.manage');
                    return (
                      <tr key={m.id} className={m.active ? '' : 'inactive'}>
                        <td><Link to={`/groups/${g.id}`}>{g.name}</Link>{m.notes && <div className="muted">{m.notes}</div>}</td>
                        <td className="muted">{GROUP_TYPE_LABEL[g.type]}</td>
                        <td><RoleChips roles={m.roles} /></td>
                        <td>{m.spotterId || <span className="muted">–</span>}</td>
                        <td>{m.joinedOn || <span className="muted">–</span>}</td>
                        <td>{m.active ? <span className="chip green">Active</span> : <span className="chip dim">Inactive</span>}</td>
                        <td className="actions">{manage && <>
                          <button className="small" onClick={() => setEditingM(m)}>Edit</button>
                          <button className="icon" title="Remove from group" onClick={() => window.confirm(`Remove ${station.call} from ${g.name}?`) && run(() => removeMembership(m.id), `Removed from ${g.name}`)}>✕</button>
                        </>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!memberships.length && <div className="empty">Not a member of any group.</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Net Activity</span><span className="muted">check-ins · notes · storm reports</span></div>
            <div className="empty">Check-ins, notes, and storm reports for {station.call} across every net will appear here once nets are built.</div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Record History</span><span className="muted">changes to this station and its memberships</span></div>
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <tbody>
                  {(history ?? []).map((h) => (
                    <tr key={h.id}>
                      <td className="muted" style={{ whiteSpace: 'nowrap', width: 150 }}>{fmtDateTime(h.at)}</td>
                      <td>{h.summary}{h.changes && <span className="muted"> · {Object.entries(h.changes).map(([k, [a, b]]) => `${k}: ${fmt(a)} → ${fmt(b)}`).join('; ')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <StationFormModal title={`Edit ${station.call}`} initial={station} onClose={() => setEditing(false)}
          onSubmit={async (f) => { const next = await updateStation(station.id, f); if (next.call !== call) nav(`/stations/${next.call}`, { replace: true }); }} />
      )}
      {editingM && (
        <MembershipModal title={`${station.call} in ${dir.groupById.get(editingM.groupId)?.name}`} initial={{ ...emptyMembership(), ...editingM }}
          onClose={() => setEditingM(null)} onSubmit={(v) => updateMembership(editingM.id, v)} />
      )}
    </>
  );
}

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '(none)' : v === '' || v == null ? '(blank)' : String(v));

