import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, live } from '../data/db';
import { assignRoles, createCustomRole, deleteCustomRole, groupRoleDefs, updateCustomRole, type CustomRoleInput } from '../data/services';
import { BUILT_IN_ROLES, PERMISSIONS, PERMISSION_AREAS, ALL_PERMISSIONS, type Permission, type RoleDef } from '../data/acl';
import type { Directory } from '../data/queries';
import type { Group, User } from '../data/types';
import { Modal, useAction } from '../ui/common';

/** Positions (built-in and custom) and who holds them in one group. Only an Admin can change anything here. */
export default function AccessPanel({ group, dir }: { group: Group; dir: Directory }) {
  const run = useAction();
  const data = useLiveQuery(async () => {
    const [roles, access, users] = await Promise.all([
      groupRoleDefs(group.id),
      db.groupAccess.where('groupId').equals(group.id).toArray(),
      db.users.toArray(),
    ]);
    return { roles, access: live(access), users: live(users) };
  }, [group.id]);
  const [editing, setEditing] = useState<RoleDef | 'new' | null>(null);
  const [assigning, setAssigning] = useState<User | null>(null);
  const [viewing, setViewing] = useState<RoleDef | null>(null);
  if (!data) return null;

  const admin = dir.isAdmin;
  const holders = (roleId: string) => data.access.filter((a) => a.roleIds.includes(roleId)).length;
  const userById = new Map(data.users.map((u) => [u.id, u]));
  const roleName = (id: string) => data.roles.find((r) => r.id === id)?.name ?? 'Removed position';
  const withAccess = data.access.map((a) => ({ a, u: userById.get(a.userId) })).filter((x) => x.u);
  const withoutAccess = data.users.filter((u) => !data.access.some((a) => a.userId === u.id));
  const mine = dir.rolesByGroup.get(group.id) ?? [];

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Positions &amp; Access</span>
        {admin && <button className="small primary" onClick={() => setEditing('new')}>+ Position</button>}
      </div>
      <div className="panel-body stack">
        <div>
          {admin
            ? <div className="hint" style={{ marginTop: 0 }}>You are the <b>Admin</b>: full access to every group, and the only one who manages users and positions.</div>
            : <div className="hint" style={{ marginTop: 0 }}>Your roles here: <b>{mine.map((r) => r.name).join(', ') || 'none'}</b>.</div>}
        </div>

        <div>
          <div className="label">Positions</div>
          {data.roles.map((r) => (
            <div key={r.id} className="row between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span>
                <button className="link" onClick={() => setViewing(r)}>{r.name}</button>
                <span className="muted"> · {r.builtIn ? 'built-in' : 'custom'} · {holders(r.id)} {holders(r.id) === 1 ? 'person' : 'people'}</span>
              </span>
              {admin && !r.builtIn && (
                <span className="row">
                  <button className="small" onClick={() => setEditing(r)}>Edit</button>
                  <button className="icon" title="Delete position" onClick={() => window.confirm(`Delete the position "${r.name}"? Anyone holding it loses it.`) && run(() => deleteCustomRole(r.id), `Deleted ${r.name}`)}>✕</button>
                </span>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="label">People</div>
          {withAccess.map(({ a, u }) => (
            <div key={a.id} className="row between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span>{u!.name}{u!.call && <span className="muted"> {u!.call}</span>}{u!.isAdmin && <span className="chip green" style={{ marginLeft: 6 }}>Admin</span>}</span>
              <span className="row">
                <span className="chips">{a.roleIds.map((id) => <span key={id} className="chip">{roleName(id)}</span>)}</span>
                {admin && <button className="small" onClick={() => setAssigning(u!)}>Roles</button>}
              </span>
            </div>
          ))}
          {!withAccess.length && <div className="muted">No one holds a position in this group yet.</div>}
          {admin && withoutAccess.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <select defaultValue="" onChange={(e) => { const u = userById.get(e.target.value); if (u) setAssigning(u); e.target.value = ''; }} style={{ width: 'auto' }}>
                <option value="" disabled>Give someone a position…</option>
                {withoutAccess.map((u) => <option key={u.id} value={u.id}>{u.name}{u.call ? ` (${u.call})` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="hint">Other people can be added once member logins exist (see the wishlist). Every permission is already checked on every change.</div>
        </div>
      </div>

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)}>
          <p className="muted" style={{ marginTop: 0 }}>{viewing.description || (viewing.builtIn ? 'Built-in position.' : 'Custom position.')}{viewing.builtIn && ' Built-in positions are fixed.'}</p>
          <PermissionList value={viewing.permissions} />
          <div className="hint">Everyone can also edit their own profile, see their own check-ins, and delete their own messages.</div>
        </Modal>
      )}
      {editing && (
        <RoleModal
          title={editing === 'new' ? `New Position in ${group.name}` : `Edit ${editing.name}`}
          initial={editing === 'new' ? { name: '', description: '', permissions: [] } : editing}
          onClose={() => setEditing(null)}
          onSubmit={(v) => (editing === 'new' ? createCustomRole(group.id, v) : updateCustomRole(editing.id, v))}
        />
      )}
      {assigning && (
        <AssignModal
          user={assigning} group={group} roles={data.roles}
          initial={data.access.find((a) => a.userId === assigning.id)?.roleIds ?? []}
          onClose={() => setAssigning(null)}
          onSubmit={(ids) => assignRoles(group.id, assigning.id, ids)}
        />
      )}
    </div>
  );
}

function PermissionList({ value, onChange }: { value: Permission[]; onChange?: (v: Permission[]) => void }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {PERMISSION_AREAS.map((area) => (
        <div key={area}>
          <div className="label">{area}</div>
          {ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].area === area).map((p) => (
            <label key={p} className="check" style={{ display: 'flex', margin: '3px 0', opacity: onChange || value.includes(p) ? 1 : 0.45 }}>
              <input type="checkbox" checked={value.includes(p)} disabled={!onChange}
                onChange={(e) => onChange?.(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
              {PERMISSIONS[p].label}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function RoleModal({ title, initial, onSubmit, onClose }: { title: string; initial: CustomRoleInput; onSubmit: (v: CustomRoleInput) => Promise<unknown>; onClose: () => void }) {
  const [v, setV] = useState<CustomRoleInput>({ name: initial.name, description: initial.description, permissions: [...initial.permissions] });
  const [err, setErr] = useState('');
  const submit = async () => { try { await onSubmit(v); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Modal title={title} onClose={onClose} footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={submit}>Save</button></>}>
      <div className="stack">
        <div className="fields">
          <div><label>Position name</label><input autoFocus value={v.name} placeholder="e.g., Skywarn Coordinator" onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div><label>Start from</label>
            <select value="" onChange={(e) => { const r = BUILT_IN_ROLES[e.target.value as keyof typeof BUILT_IN_ROLES]; if (r) setV({ ...v, permissions: [...r.permissions] }); }}>
              <option value="">Copy permissions from…</option>
              {Object.values(BUILT_IN_ROLES).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="full"><label>Description</label><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
        </div>
        <PermissionList value={v.permissions} onChange={(permissions) => setV({ ...v, permissions })} />
        <div className="hint">Managing users and positions is always Admin-only and cannot be given to a position.</div>
      </div>
    </Modal>
  );
}

function AssignModal({ user, group, roles, initial, onSubmit, onClose }: { user: User; group: Group; roles: RoleDef[]; initial: string[]; onSubmit: (ids: string[]) => Promise<unknown>; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>(initial);
  const [err, setErr] = useState('');
  const submit = async () => { try { await onSubmit(ids); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <Modal title={`${user.name} in ${group.name}`} onClose={onClose} footer={<><span className="err spacer">{err}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={submit}>Save</button></>}>
      <div className="stack">
        {roles.map((r) => (
          <label key={r.id} className="check" style={{ display: 'flex', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={ids.includes(r.id)} onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id))} />
            <span><b>{r.name}</b> <span className="muted">{r.description}</span></span>
          </label>
        ))}
        <div className="hint">Holding several positions combines their permissions. Clearing every box removes this person's access to the group.</div>
      </div>
    </Modal>
  );
}
