import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDirectory, searchStations, stationLocation, distinctOnAirName } from '../data/queries';
import { addMembership, createStation, emptyStation } from '../data/services';
import { STATION_STATUS_LABEL, type StationStatus } from '../data/types';
import { roleAllows } from '../data/acl';
import { StationFormModal } from '../ui/forms';
import { Highlight, useAction } from '../ui/common';
import { downloadText, toCsv } from '../lib/csv';

type StatusFilter = StationStatus | 'all';

export default function StationsPage() {
  const dir = useDirectory();
  const nav = useNavigate();
  const run = useAction();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [groupId, setGroupId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addTo, setAddTo] = useState('');

  const rows = useMemo(() => {
    if (!dir) return [];
    let list = dir.stations;
    if (status !== 'all') list = list.filter((s) => s.status === status);
    if (groupId === '_none') list = list.filter((s) => !dir.membershipsByStation.get(s.id)?.length);
    else if (groupId) list = list.filter((s) => dir.membershipsByStation.get(s.id)?.some((m) => m.groupId === groupId));
    return searchStations(list, q);
  }, [dir, q, status, groupId]);

  if (!dir) return null;
  const manageable = dir.groups.filter((g) => roleAllows(dir.roleByGroup.get(g.id), 'members.manage'));

  const exportCsv = () => downloadText('stations.csv', toCsv([
    ['call', 'name', 'on_air_name', 'city', 'county', 'state', 'grid', 'status', 'groups', 'previous_calls', 'notes'],
    ...rows.map(({ station: s }) => [s.call, s.name, s.onAirName, s.city, s.county, s.state, s.grid, STATION_STATUS_LABEL[s.status],
      (dir.membershipsByStation.get(s.id) ?? []).map((m) => dir.groupById.get(m.groupId)?.name).join('; '), s.previousCalls.join(' '), s.notes]),
  ]));

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Directory</div><h1>Stations</h1></div>
        <div className="row"><button onClick={exportCsv} disabled={!rows.length}>Export CSV</button><button className="primary" onClick={() => setAdding(true)}>+ Add Station</button></div>
      </div>
      <div className="panel">
        <div className="toolbar">
          <input type="search" placeholder="Call (prefix or suffix), name, city…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {(['active', 'inactive', 'sk', 'all'] as StatusFilter[]).map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : STATION_STATUS_LABEL[s]}</button>
            ))}
          </div>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Any group</option>
            {dir.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="_none">In no group</option>
          </select>
          <span className="spacer" />
          <span className="muted">{rows.length} of {dir.stations.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Call</th><th>Name</th><th>Location</th><th>Groups</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ station: s }) => (
                <tr key={s.id} className={'clickable' + (s.status !== 'active' ? ' inactive' : '')} onClick={() => nav(`/stations/${s.call}`)}>
                  <td className="call"><Highlight text={s.call} q={q.toUpperCase().replace(/[^A-Z0-9]/g, '')} />{s.previousCalls.length > 0 && <span className="muted"> (was {s.previousCalls.join(', ')})</span>}</td>
                  <td>{s.name || s.onAirName}{distinctOnAirName(s) && <span className="muted"> “{distinctOnAirName(s)}”</span>}</td>
                  <td>{stationLocation(s)}</td>
                  <td><span className="chips">{(dir.membershipsByStation.get(s.id) ?? []).map((m) => {
                    const g = dir.groupById.get(m.groupId)!;
                    return <Link key={m.id} className={'chip' + (m.active ? '' : ' dim')} to={`/groups/${g.id}`} onClick={(e) => e.stopPropagation()}>{g.name}</Link>;
                  })}</span></td>
                  <td>{s.status === 'active' ? <span className="chip green">Active</span> : s.status === 'sk' ? <span className="chip">Silent Key</span> : <span className="chip dim">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">{dir.stations.length ? 'No stations match.' : 'No stations yet. Add one here, or import a CSV into a group.'}</div>}
        </div>
      </div>

      {adding && (
        <StationFormModal
          title="Add Station"
          submitLabel="Add Station"
          initial={emptyStation(q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
          onClose={() => setAdding(false)}
          extra={manageable.length > 0 && (
            <><label>Also add to group</label>
              <select value={addTo} onChange={(e) => setAddTo(e.target.value)}>
                <option value="">No group</option>
                {manageable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select></>
          )}
          onSubmit={async (f) => {
            const st = await createStation(f);
            if (addTo) await run(() => addMembership(addTo, st.id), `${st.call} added to ${dir.groupById.get(addTo)?.name}`);
            nav(`/stations/${st.call}`);
          }}
        />
      )}
    </>
  );
}
