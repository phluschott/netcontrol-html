import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDirectory, myRoleLabel } from '../data/queries';
import { createGroup } from '../data/services';
import { GROUP_TYPE_LABEL } from '../data/types';
import { GroupFormModal } from '../ui/forms';

export default function GroupsPage() {
  const dir = useDirectory();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  if (!dir) return null;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Organization</div><h1>Groups</h1></div>
        {dir.isAdmin && <button className="primary" onClick={() => setCreating(true)}>+ New Group</button>}
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Group</th><th>Type</th><th>Counties</th><th>Members</th><th>Spotters</th><th>Net Control</th><th>Your role</th></tr></thead>
            <tbody>
              {dir.groups.map((g) => {
                const ms = (dir.membershipsByGroup.get(g.id) ?? []).filter((m) => m.active);
                const role = myRoleLabel(dir, g.id);
                return (
                  <tr key={g.id} className="clickable" onClick={() => nav(`/groups/${g.id}`)}>
                    <td><Link to={`/groups/${g.id}`} className="call" onClick={(e) => e.stopPropagation()}>{g.name}</Link>{g.description && <div className="muted">{g.description}</div>}</td>
                    <td><span className="chip">{GROUP_TYPE_LABEL[g.type]}</span></td>
                    <td className="muted">{g.counties.join(', ') || '–'}</td>
                    <td>{ms.length}</td>
                    <td>{ms.filter((m) => m.roles.includes('spotter')).length || <span className="muted">–</span>}</td>
                    <td>{ms.filter((m) => m.roles.includes('ncs')).length || <span className="muted">–</span>}</td>
                    <td>{role ? <span className={'chip ' + (dir.isAdmin ? 'green' : '')}>{role}</span> : <span className="muted">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!dir.groups.length && (
            <div className="empty">
              <p>No groups yet. A group is a Skywarn team, club, ARES unit, or traffic net.</p>
              <p>Create one, then add members by hand or import a CSV. Stations already in the directory are reused, never duplicated.</p>
              {dir.isAdmin ? <button className="primary" onClick={() => setCreating(true)}>+ New Group</button> : <p>Only an Admin can create groups.</p>}
            </div>
          )}
        </div>
      </div>
      {creating && (
        <GroupFormModal title="New Group" initial={{ name: '', type: 'skywarn', description: '', counties: [], settings: {} }}
          onClose={() => setCreating(false)}
          onSubmit={async (f) => { const g = await createGroup(f); nav(`/groups/${g.id}`); }} />
      )}
    </>
  );
}
