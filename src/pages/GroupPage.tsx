import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDirectory, searchStations, stationLocation, distinctOnAirName, hasPerm, myRoleLabel } from '../data/queries';
import {
  addStationToGroup, deleteGroup, emptyMembership, findStationByCall, removeMembership, updateGroup, updateMembership,
} from '../data/services';
import { GROUP_TYPE_LABEL, MEMBER_ROLE_LABEL, type Membership, type MembershipFields, type MemberRole, type Station } from '../data/types';
import { GroupFormModal, MembershipEditor, MembershipModal, RoleChips } from '../ui/forms';
import { Highlight, Modal, fmtDate, useAction } from '../ui/common';
import { baseCall, callError, cleanCallInput } from '../lib/callsign';
import { downloadText, toCsv } from '../lib/csv';
import ImportModal from './ImportModal';
import AccessPanel from './AccessPanel';

type RoleFilter = 'all' | MemberRole | 'inactive';

export default function GroupPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const run = useAction();
  const dir = useDirectory();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingM, setEditingM] = useState<{ m: Membership; s: Station } | null>(null);

  const group = dir?.groupById.get(id);
  const members = useMemo(() => {
    if (!dir || !group) return [];
    const byId = new Map(dir.stations.map((s) => [s.id, s]));
    return (dir.membershipsByGroup.get(id) ?? []).map((m) => ({ m, s: byId.get(m.stationId)! })).filter((x) => x.s);
  }, [dir, group, id]);
  const shown = useMemo(() => {
    const filtered = members.filter(({ m }) => roleFilter === 'all' ? m.active : roleFilter === 'inactive' ? !m.active : m.active && m.roles.includes(roleFilter));
    const ranked = searchStations(filtered.map((x) => x.s), q);
    const mByStation = new Map(filtered.map((x) => [x.s.id, x.m]));
    return ranked.map(({ station }) => ({ s: station, m: mByStation.get(station.id)! }));
  }, [members, roleFilter, q]);

  if (!dir) return null;
  if (!group) return <div className="panel"><div className="empty">Group not found. <Link to="/groups">Back to groups</Link></div></div>;

  const role = myRoleLabel(dir, id);
  const canManage = hasPerm(dir, id, 'members.manage');
  const canEdit = hasPerm(dir, id, 'group.edit');
  const canDelete = hasPerm(dir, id, 'group.delete');
  const canSeeMembers = hasPerm(dir, id, 'members.view');
  const activeCount = members.filter((x) => x.m.active).length;

  const exportCsv = () => downloadText(`${group.name.replace(/\W+/g, '_')}_members.csv`, toCsv([
    ['call', 'name', 'on_air_name', 'city', 'county', 'state', 'roles', 'spotter_id', 'active', 'joined', 'notes'],
    ...members.map(({ m, s }) => [s.call, s.name, s.onAirName, s.city, s.county, s.state, m.roles.map((r) => MEMBER_ROLE_LABEL[r]).join('; '), m.spotterId, m.active ? 'yes' : 'no', m.joinedOn, m.notes]),
  ]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link to="/groups">Groups</Link> /</div>
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h1>{group.name}</h1>
            <span className="chip">{GROUP_TYPE_LABEL[group.type]}</span>
            {role && <span className="chip green">You: {role}</span>}
          </div>
          {group.description && <div className="muted">{group.description}</div>}
        </div>
        <div className="row">
          {canEdit && <button onClick={() => setEditing(true)}>Edit Group</button>}
          {canDelete && <button className="danger" onClick={async () => {
            if (!window.confirm(`Delete ${group.name}? Its ${members.length} memberships are removed. Stations stay in the directory.`)) return;
            if (await run(() => deleteGroup(group.id).then(() => true), `${group.name} deleted`)) nav('/groups');
          }}>Delete</button>}
        </div>
      </div>

      <div className="grid-side" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,300px)' }}>
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Members<span className="panel-count">{activeCount}</span></span>
            <div className="row">
              <button className="small" onClick={exportCsv} disabled={!members.length}>Export CSV</button>
              {canManage && <button className="small" onClick={() => setImporting(true)}>Import CSV</button>}
              {canManage && <button className="small primary" onClick={() => setAdding(true)}>+ Add Member</button>}
            </div>
          </div>
          <div className="toolbar">
            <input type="search" placeholder="Call (prefix or suffix), name, city…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="seg">
              {(['all', 'spotter', 'ncs', 'officer', 'inactive'] as RoleFilter[]).map((r) => (
                <button key={r} className={roleFilter === r ? 'on' : ''} onClick={() => setRoleFilter(r)}>
                  {r === 'all' ? 'Active' : r === 'inactive' ? 'Inactive' : MEMBER_ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <span className="spacer" /><span className="muted">{shown.length} shown</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Call</th><th>Name</th><th>Location</th><th>Roles</th><th>Spotter ID</th><th>Joined</th><th /></tr></thead>
              <tbody>
                {canSeeMembers && shown.map(({ m, s }) => (
                  <tr key={m.id} className={'clickable' + (m.active && s.status === 'active' ? '' : ' inactive')} onClick={() => nav(`/stations/${s.call}`)}>
                    <td className="call"><Highlight text={s.call} q={q.toUpperCase().replace(/[^A-Z0-9]/g, '')} />{s.status === 'sk' && <span className="chip" style={{ marginLeft: 6 }}>SK</span>}</td>
                    <td>{s.name || s.onAirName}{distinctOnAirName(s) && <span className="muted"> “{distinctOnAirName(s)}”</span>}</td>
                    <td>{stationLocation(s)}</td>
                    <td><RoleChips roles={m.roles} /></td>
                    <td>{m.spotterId || <span className="muted">–</span>}</td>
                    <td className="muted">{m.joinedOn || '–'}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>{canManage && <>
                      <button className="small" onClick={() => setEditingM({ m, s })}>Edit</button>
                      <button className="icon" title="Remove from group" onClick={() => window.confirm(`Remove ${s.call} from ${group.name}? The station stays in the directory.`) && run(() => removeMembership(m.id), `${s.call} removed`)}>✕</button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canSeeMembers && !shown.length && <div className="empty">{members.length ? 'No members match.' : 'No members yet. Add them one at a time, or import a CSV.'}</div>}
            {!canSeeMembers && <div className="empty">Your position in this group does not include viewing the member list.</div>}
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Group</span></div>
            <div className="panel-body">
              <dl className="dl" style={{ gridTemplateColumns: '90px 1fr' }}>
                <dt>Type</dt><dd>{GROUP_TYPE_LABEL[group.type]}</dd>
                <dt>Counties</dt><dd>{group.counties.join(', ') || '–'}</dd>
                <dt>Members</dt><dd>{activeCount} active{members.length > activeCount && `, ${members.length - activeCount} inactive`}</dd>
                <dt>Spotters</dt><dd>{members.filter((x) => x.m.active && x.m.roles.includes('spotter')).length}</dd>
                <dt>Net control</dt><dd>{members.filter((x) => x.m.active && x.m.roles.includes('ncs')).map((x) => x.s.call).join(', ') || '–'}</dd>
                <dt>Created</dt><dd>{fmtDate(group.createdAt)}</dd>
              </dl>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Nets</span></div>
            <div className="empty">Nets for this group come next. We will design them together first.</div>
          </div>
          <AccessPanel group={group} dir={dir} />
        </div>
      </div>

      {editing && <GroupFormModal title={`Edit ${group.name}`} initial={group} onClose={() => setEditing(false)} onSubmit={(f) => updateGroup(group.id, f)} />}
      {adding && <AddMemberModal groupId={group.id} groupName={group.name} existingIds={new Set(members.map((x) => x.s.id))} stations={dir.stations} onClose={() => setAdding(false)} />}
      {importing && <ImportModal group={group} onClose={() => setImporting(false)} />}
      {editingM && (
        <MembershipModal title={`${editingM.s.call} in ${group.name}`} initial={{ ...emptyMembership(), ...editingM.m }}
          onClose={() => setEditingM(null)} onSubmit={(v) => updateMembership(editingM.m.id, v)} />
      )}
    </>
  );
}

function AddMemberModal({ groupId, groupName, existingIds, stations, onClose }: {
  groupId: string; groupName: string; existingIds: Set<string>; stations: Station[]; onClose: () => void;
}) {
  const run = useAction();
  const [call, setCall] = useState('');
  const [fields, setFields] = useState({ name: '', onAirName: '', city: '', county: '', state: '' });
  const [membership, setMembership] = useState<MembershipFields>(emptyMembership());
  const [err, setErr] = useState('');
  const base = baseCall(call);
  const found = useLiveQuery(() => (base ? findStationByCall(base) : Promise.resolve(null)), [base]);
  const suggestions = call && !found ? searchStations(stations.filter((s) => !existingIds.has(s.id)), call, 6) : [];
  const already = found && existingIds.has(found.station.id);

  const submit = async (another: boolean) => {
    const e = callError(base);
    if (e) { setErr(e); return; }
    if (already) { setErr(`${found!.station.call} is already a member.`); return; }
    const saved = { call, fields };
    // Clear right away so typing the next call is never lost while the save runs.
    if (another) { setCall(''); setFields({ name: '', onAirName: '', city: '', county: '', state: '' }); setErr(''); document.getElementById('add-call')?.focus(); }
    const r = await run(() => addStationToGroup(groupId, { call: base, ...saved.fields }, membership), `${base} added to ${groupName}`);
    if (!r) { if (another) { setCall(saved.call); setFields(saved.fields); } return; }
    if (!another) onClose();
  };

  return (
    <Modal title={`Add Member to ${groupName}`} onClose={onClose}
      footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button onClick={() => submit(true)}>Add &amp; Next</button><button className="primary" onClick={() => submit(false)}>Add</button></>}>
      <div className="stack">
        <div>
          <label>Call sign</label>
          <input id="add-call" className="call-input" autoFocus value={call} maxLength={12} placeholder="Type a call; existing stations are found as you type"
            onChange={(e) => { setCall(cleanCallInput(e.target.value)); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(false); } }} />
          {found && (
            <div className={'hint ' + (already ? 'warn-text' : 'ok')}>
              {already ? 'Already a member of this group: ' : 'In the directory: '}
              <b>{found.station.call}</b> {found.station.name} {stationLocation(found.station) && `· ${stationLocation(found.station)}`}
              {found.viaPrevious && ` (${base} is a previous call)`}
            </div>
          )}
          {!found && base && !callError(base) && <div className="hint">New station. It will be added to the directory.</div>}
          {suggestions.length > 0 && (
            <div className="chips" style={{ marginTop: 6 }}>
              {suggestions.map(({ station }) => <button key={station.id} className="small" onClick={() => setCall(station.call)}>{station.call} <span className="muted">{station.name}</span></button>)}
            </div>
          )}
        </div>
        {!found && (
          <div className="fields">
            <div><label>Full name</label><input value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} /></div>
            <div><label>On-air name</label><input value={fields.onAirName} onChange={(e) => setFields({ ...fields, onAirName: e.target.value })} /></div>
            <div><label>City</label><input value={fields.city} onChange={(e) => setFields({ ...fields, city: e.target.value })} /></div>
            <div><label>County</label><input value={fields.county} onChange={(e) => setFields({ ...fields, county: e.target.value })} /></div>
            <div><label>State</label><input value={fields.state} maxLength={3} onChange={(e) => setFields({ ...fields, state: e.target.value.toUpperCase() })} /></div>
          </div>
        )}
        <MembershipEditor value={membership} onChange={setMembership} />
      </div>
    </Modal>
  );
}
