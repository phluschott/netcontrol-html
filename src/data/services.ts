/**
 * All writes go through this module. Each write:
 *  1. checks the current user's permission,
 *  2. stamps audit fields on the record,
 *  3. records an AuditEntry.
 * Reads can use db directly.
 */
import { db, getMeta, live, setMeta } from './db';
import { ALL_PERMISSIONS, BUILT_IN_ROLES, PermissionError, isBuiltInRole, permissionsOf, type Permission, type RoleDef } from './acl';
import { baseCall, callError, isValidCall } from '../lib/callsign';
import type {
  AuditEntry, CustomRole, Group, GroupAccess, GroupFields, ID, Membership, MembershipFields, Meta,
  Station, StationFields, User,
} from './types';

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

/* ---------------- users ---------------- */

export async function ensureLocalUser(): Promise<User> {
  const id = await getMeta<string>('currentUserId');
  if (id) {
    const u = await db.users.get(id);
    if (u) return u;
  }
  const userId = uuid();
  const t = nowIso();
  // The first user in this browser is the Admin.
  const isAdmin = (await db.users.count()) === 0;
  const user: User = { id: userId, createdAt: t, createdBy: userId, updatedAt: t, updatedBy: userId, deletedAt: null, name: 'Local operator', call: '', email: '', isAdmin };
  await db.users.add(user);
  await setMeta('currentUserId', userId);
  return user;
}

export async function currentUserId(): Promise<ID> {
  const id = await getMeta<string>('currentUserId');
  if (!id) return (await ensureLocalUser()).id;
  return id;
}

export async function updateCurrentUser(patch: Partial<Pick<User, 'name' | 'call' | 'email'>>) {
  const userId = await currentUserId();
  const before = await db.users.get(userId);
  if (!before) throw new ValidationError('No current user.');
  const next = { ...before, ...trimAll(patch), updatedAt: nowIso(), updatedBy: userId };
  await db.transaction('rw', db.users, db.audit, async () => {
    await db.users.put(next);
    await audit(userId, 'user', userId, 'update', diff(before, next, ['name', 'call', 'email']), 'Updated profile');
  });
}

/* ---------------- helpers ---------------- */

function newMeta(userId: ID): Meta {
  const t = nowIso();
  return { id: uuid(), createdAt: t, createdBy: userId, updatedAt: t, updatedBy: userId, deletedAt: null };
}

function trimAll<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out as T;
}

function diff(before: object, after: object, keys: string[]): Record<string, [unknown, unknown]> | null {
  const b = before as Record<string, unknown>, a = after as Record<string, unknown>;
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of keys) if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out[k] = [b[k], a[k]];
  return Object.keys(out).length ? out : null;
}

async function audit(userId: ID, entity: AuditEntry['entity'], entityId: ID, action: AuditEntry['action'], changes: AuditEntry['changes'], summary: string) {
  await db.audit.add({ id: uuid(), at: nowIso(), userId, entity, entityId, action, changes, summary });
}

/* ---------------- permissions ---------------- */

export async function isAdmin(userId?: ID): Promise<boolean> {
  const u = await db.users.get(userId ?? (await currentUserId()));
  return !!u && !u.deletedAt && u.isAdmin === true;
}

/** Role definitions (built-in and custom) a user holds in a group. */
export async function rolesInGroup(groupId: ID, userId?: ID): Promise<RoleDef[]> {
  const uid = userId ?? (await currentUserId());
  const row = await db.groupAccess.where('[groupId+userId]').equals([groupId, uid]).first();
  if (!row || row.deletedAt) return [];
  const out: RoleDef[] = [];
  for (const id of row.roleIds) {
    if (isBuiltInRole(id)) { out.push(BUILT_IN_ROLES[id]); continue; }
    const r = await db.roles.get(id);
    if (r && !r.deletedAt && r.groupId === groupId) out.push({ id: r.id, name: r.name, permissions: r.permissions, builtIn: false, description: r.description });
  }
  return out;
}

/** Everything a user may do in a group. Admins may do everything. */
export async function groupPermissions(groupId: ID, userId?: ID): Promise<Set<Permission>> {
  const uid = userId ?? (await currentUserId());
  if (await isAdmin(uid)) return new Set(ALL_PERMISSIONS);
  return permissionsOf(await rolesInGroup(groupId, uid));
}

export async function can(perm: Permission, groupId: ID, userId?: ID): Promise<boolean> {
  return (await groupPermissions(groupId, userId)).has(perm);
}

async function requirePerm(perm: Permission, groupId: ID, userId: ID) {
  if (!(await can(perm, groupId, userId))) throw new PermissionError(perm, groupId);
}

async function requireAdmin(userId: ID) {
  if (!(await isAdmin(userId))) throw new PermissionError('admin');
}

/** Tables every permission check reads; include them in any transaction that checks permissions. */
const permTables = () => [db.users, db.groupAccess, db.roles, db.meta];

/** A station is shared. A user may edit it if they are Admin, created it, it belongs to no group, or they hold stations.edit in any group it belongs to. */
export async function canEditStation(stationId: ID, userId?: ID): Promise<boolean> {
  const uid = userId ?? (await currentUserId());
  const st = await db.stations.get(stationId);
  if (!st || st.deletedAt) return false;
  if (await isAdmin(uid)) return true;
  if (st.createdBy === uid) return true;
  const ms = live(await db.memberships.where('stationId').equals(stationId).toArray());
  if (!ms.length) return true;
  for (const m of ms) if (await can('stations.edit', m.groupId, uid)) return true;
  return false;
}

/* ---------------- stations ---------------- */

const STATION_KEYS: (keyof StationFields)[] = ['call', 'name', 'onAirName', 'city', 'county', 'state', 'grid', 'status', 'notes', 'previousCalls'];

export function emptyStation(call = ''): StationFields {
  return { call, name: '', onAirName: '', city: '', county: '', state: '', grid: '', status: 'active', notes: '', previousCalls: [] };
}

function normalizeStation(f: StationFields): StationFields {
  const t = trimAll(f);
  return {
    ...t,
    call: t.call.toUpperCase(),
    state: t.state.toUpperCase(),
    grid: t.grid ? t.grid.slice(0, 2).toUpperCase() + t.grid.slice(2, 4) + t.grid.slice(4).toLowerCase() : '',
    previousCalls: [...new Set(t.previousCalls.map((c) => c.toUpperCase()).filter((c) => c && c !== t.call.toUpperCase()))],
  };
}

/** Find the live station that holds this call, either as its current call or a previous one. */
export async function findStationByCall(raw: string): Promise<{ station: Station; viaPrevious: boolean } | null> {
  const call = baseCall(raw);
  if (!call) return null;
  const current = await db.stations.where('call').equals(call).first();
  if (current && !current.deletedAt) return { station: current, viaPrevious: false };
  const prev = live(await db.stations.where('previousCalls').equals(call).toArray())[0];
  return prev ? { station: prev, viaPrevious: true } : null;
}

async function assertCallFree(call: string, exceptId?: ID) {
  const err = callError(call);
  if (err) throw new ValidationError(err);
  const hit = await findStationByCall(call);
  if (hit && hit.station.id !== exceptId) {
    throw new ValidationError(hit.viaPrevious
      ? `${call} is a previous call sign of ${hit.station.call}.`
      : `${call} is already in the station directory.`);
  }
}

export async function createStation(input: Partial<StationFields> & { call: string }): Promise<Station> {
  const userId = await currentUserId();
  const fields = normalizeStation({ ...emptyStation(), ...input, call: baseCall(input.call) });
  return db.transaction('rw', db.stations, db.audit, async () => {
    await assertCallFree(fields.call);
    const deleted = await db.stations.where('call').equals(fields.call).first();
    if (deleted) {
      // Revive a soft-deleted station rather than violate the unique call index.
      const revived: Station = { ...deleted, ...fields, deletedAt: null, updatedAt: nowIso(), updatedBy: userId };
      await db.stations.put(revived);
      await audit(userId, 'station', revived.id, 'restore', null, `Restored ${revived.call}`);
      return revived;
    }
    const st: Station = { ...newMeta(userId), ...fields };
    await db.stations.add(st);
    await audit(userId, 'station', st.id, 'create', null, `Added ${st.call}`);
    return st;
  });
}

export async function updateStation(id: ID, patch: Partial<StationFields>): Promise<Station> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.stations, db.memberships, db.audit, ...permTables()], async () => {
    const before = await db.stations.get(id);
    if (!before || before.deletedAt) throw new ValidationError('Station not found.');
    if (!(await canEditStation(id, userId))) throw new ValidationError(`You do not have permission to edit ${before.call}.`);
    let fields = normalizeStation({ ...pickStation(before), ...patch });
    if (fields.call !== before.call) {
      await assertCallFree(fields.call, id);
      // Keep history: the old call becomes a previous call.
      fields = normalizeStation({ ...fields, previousCalls: [...fields.previousCalls, before.call] });
      const stale = await db.stations.where('call').equals(fields.call).first();
      if (stale && stale.deletedAt) await db.stations.delete(stale.id); // free the unique index from a long-deleted record
    }
    const next: Station = { ...before, ...fields, updatedAt: nowIso(), updatedBy: userId };
    const changes = diff(before, next, STATION_KEYS);
    if (!changes) return before;
    await db.stations.put(next);
    await audit(userId, 'station', id, 'update', changes, `Updated ${next.call}`);
    return next;
  });
}

function pickStation(s: Station): StationFields {
  const out = {} as Record<string, unknown>;
  for (const k of STATION_KEYS) out[k] = s[k];
  return out as unknown as StationFields;
}

export async function deleteStation(id: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', [db.stations, db.memberships, db.audit, ...permTables()], async () => {
    const st = await db.stations.get(id);
    if (!st || st.deletedAt) return;
    if (!(await canEditStation(id, userId))) throw new ValidationError(`You do not have permission to delete ${st.call}.`);
    const ms = live(await db.memberships.where('stationId').equals(id).toArray());
    if (ms.length) throw new ValidationError(`${st.call} is a member of ${ms.length} group(s). Remove those memberships first, or mark the station Inactive or Silent Key to keep its history.`);
    await db.stations.update(id, { deletedAt: nowIso(), updatedAt: nowIso(), updatedBy: userId });
    await audit(userId, 'station', id, 'delete', null, `Deleted ${st.call}`);
  });
}

/* ---------------- groups ---------------- */

const GROUP_KEYS: (keyof GroupFields)[] = ['name', 'type', 'description', 'counties', 'settings'];

function normalizeGroup(f: GroupFields): GroupFields {
  return { ...f, name: f.name.trim(), description: f.description.trim(), counties: [...new Set(f.counties.map((c) => c.trim()).filter(Boolean))] };
}

export async function createGroup(input: Partial<GroupFields> & { name: string }): Promise<Group> {
  const userId = await currentUserId();
  const fields = normalizeGroup({ type: 'club', description: '', counties: [], settings: {}, ...input });
  if (!fields.name) throw new ValidationError('A group needs a name.');
  return db.transaction('rw', [db.groups, db.audit, ...permTables()], async () => {
    await requireAdmin(userId);
    const g: Group = { ...newMeta(userId), ...fields };
    await db.groups.add(g);
    await audit(userId, 'group', g.id, 'create', null, `Created group ${g.name}`);
    return g;
  });
}

export async function updateGroup(id: ID, patch: Partial<GroupFields>): Promise<Group> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.groups, db.audit, ...permTables()], async () => {
    await requirePerm('group.edit', id, userId);
    const before = await db.groups.get(id);
    if (!before || before.deletedAt) throw new ValidationError('Group not found.');
    const fields = normalizeGroup({ ...before, ...patch });
    if (!fields.name) throw new ValidationError('A group needs a name.');
    const next: Group = { ...before, ...fields, updatedAt: nowIso(), updatedBy: userId };
    const changes = diff(before, next, GROUP_KEYS);
    if (!changes) return before;
    await db.groups.put(next);
    await audit(userId, 'group', id, 'update', changes, `Updated group ${next.name}`);
    return next;
  });
}

export async function deleteGroup(id: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', [db.groups, db.memberships, db.audit, ...permTables()], async () => {
    await requirePerm('group.delete', id, userId);
    const g = await db.groups.get(id);
    if (!g || g.deletedAt) return;
    const t = nowIso();
    await db.groups.update(id, { deletedAt: t, updatedAt: t, updatedBy: userId });
    await db.memberships.where('groupId').equals(id).modify({ deletedAt: t, updatedAt: t, updatedBy: userId });
    await db.groupAccess.where('groupId').equals(id).modify({ deletedAt: t, updatedAt: t, updatedBy: userId });
    await db.roles.where('groupId').equals(id).modify({ deletedAt: t, updatedAt: t, updatedBy: userId });
    await audit(userId, 'group', id, 'delete', null, `Deleted group ${g.name}`);
  });
}

/* ---------------- memberships ---------------- */

export function emptyMembership(): MembershipFields {
  return { roles: ['member'], spotterId: '', active: true, joinedOn: '', notes: '' };
}

async function upsertMembershipTx(userId: ID, groupId: ID, stationId: ID, fields: MembershipFields): Promise<{ m: Membership; created: boolean }> {
  const existing = await db.memberships.where('[groupId+stationId]').equals([groupId, stationId]).first();
  if (existing && !existing.deletedAt) return { m: existing, created: false };
  if (existing) {
    const revived: Membership = { ...existing, ...fields, deletedAt: null, updatedAt: nowIso(), updatedBy: userId };
    await db.memberships.put(revived);
    return { m: revived, created: true };
  }
  const m: Membership = { ...newMeta(userId), groupId, stationId, ...fields };
  await db.memberships.add(m);
  return { m, created: true };
}

export async function addMembership(groupId: ID, stationId: ID, fields: Partial<MembershipFields> = {}): Promise<Membership> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.memberships, db.groups, db.stations, db.audit, ...permTables()], async () => {
    await requirePerm('members.manage', groupId, userId);
    const st = await db.stations.get(stationId);
    const g = await db.groups.get(groupId);
    if (!st || st.deletedAt || !g || g.deletedAt) throw new ValidationError('Station or group not found.');
    const { m, created } = await upsertMembershipTx(userId, groupId, stationId, { ...emptyMembership(), ...fields });
    if (!created) throw new ValidationError(`${st.call} is already a member of ${g.name}.`);
    await audit(userId, 'membership', m.id, 'create', null, `Added ${st.call} to ${g.name}`);
    return m;
  });
}

/** Find or create the station by call sign, then add it to the group. */
export async function addStationToGroup(groupId: ID, input: Partial<StationFields> & { call: string }, membership: Partial<MembershipFields> = {}) {
  input = { ...input, call: baseCall(input.call) };
  const hit = await findStationByCall(input.call);
  const station = hit ? hit.station : await createStation(input);
  const m = await addMembership(groupId, station.id, membership);
  return { station, membership: m, existed: !!hit };
}

export async function updateMembership(id: ID, patch: Partial<MembershipFields>): Promise<Membership> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.memberships, db.audit, ...permTables()], async () => {
    const before = await db.memberships.get(id);
    if (!before || before.deletedAt) throw new ValidationError('Membership not found.');
    await requirePerm('members.manage', before.groupId, userId);
    const next: Membership = { ...before, ...trimAll(patch), updatedAt: nowIso(), updatedBy: userId };
    if (!next.roles.length) next.roles = ['member'];
    const changes = diff(before, next, ['roles', 'spotterId', 'active', 'joinedOn', 'notes']);
    if (!changes) return before;
    await db.memberships.put(next);
    await audit(userId, 'membership', id, 'update', changes, 'Updated membership');
    return next;
  });
}

export async function removeMembership(id: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', [db.memberships, db.stations, db.groups, db.audit, ...permTables()], async () => {
    const m = await db.memberships.get(id);
    if (!m || m.deletedAt) return;
    await requirePerm('members.manage', m.groupId, userId);
    const [st, g] = await Promise.all([db.stations.get(m.stationId), db.groups.get(m.groupId)]);
    await db.memberships.update(id, { deletedAt: nowIso(), updatedAt: nowIso(), updatedBy: userId });
    await audit(userId, 'membership', id, 'delete', null, `Removed ${st?.call ?? 'station'} from ${g?.name ?? 'group'}`);
  });
}

/* ---------------- roles & access (Admin only) ---------------- */

/** All roles that can be assigned in a group: the fixed built-ins plus the group's custom positions. */
export async function groupRoleDefs(groupId: ID): Promise<RoleDef[]> {
  const custom = live(await db.roles.where('groupId').equals(groupId).toArray())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ id: r.id, name: r.name, permissions: r.permissions, builtIn: false, description: r.description }));
  return [...Object.values(BUILT_IN_ROLES), ...custom];
}

/** Set exactly which roles a user holds in a group. An empty list removes their access to the group. */
export async function assignRoles(groupId: ID, targetUserId: ID, roleIds: string[]): Promise<GroupAccess | null> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.groups, db.audit, ...permTables()], async () => {
    await requireAdmin(userId);
    const g = await db.groups.get(groupId);
    if (!g || g.deletedAt) throw new ValidationError('Group not found.');
    const valid = new Set((await groupRoleDefs(groupId)).map((r) => r.id));
    const bad = roleIds.filter((r) => !valid.has(r));
    if (bad.length) throw new ValidationError('Unknown role for this group.');
    const ids = [...new Set(roleIds)];
    const existing = await db.groupAccess.where('[groupId+userId]').equals([groupId, targetUserId]).first();
    const t = nowIso();
    if (!ids.length) {
      if (existing && !existing.deletedAt) {
        await db.groupAccess.update(existing.id, { deletedAt: t, updatedAt: t, updatedBy: userId, roleIds: [] });
        await audit(userId, 'groupAccess', existing.id, 'delete', { roleIds: [existing.roleIds, []] }, `Removed access to ${g.name}`);
      }
      return null;
    }
    if (existing) {
      const next: GroupAccess = { ...existing, roleIds: ids, deletedAt: null, updatedAt: t, updatedBy: userId };
      await db.groupAccess.put(next);
      await audit(userId, 'groupAccess', next.id, 'update', { roleIds: [existing.deletedAt ? [] : existing.roleIds, ids] }, `Changed roles in ${g.name}`);
      return next;
    }
    const row: GroupAccess = { ...newMeta(userId), groupId, userId: targetUserId, roleIds: ids };
    await db.groupAccess.add(row);
    await audit(userId, 'groupAccess', row.id, 'create', { roleIds: [[], ids] }, `Granted roles in ${g.name}`);
    return row;
  });
}

export interface CustomRoleInput { name: string; description: string; permissions: Permission[] }

async function checkRoleName(groupId: ID, name: string, exceptId?: ID) {
  const n = name.trim().toLowerCase();
  if (!n) throw new ValidationError('A position needs a name.');
  const builtIn = Object.values(BUILT_IN_ROLES).some((r) => r.name.toLowerCase() === n);
  const custom = live(await db.roles.where('groupId').equals(groupId).toArray()).some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === n);
  if (builtIn || custom) throw new ValidationError(`There is already a position named "${name.trim()}" in this group.`);
}

const cleanPerms = (ps: Permission[]) => ALL_PERMISSIONS.filter((p) => ps.includes(p));

export async function createCustomRole(groupId: ID, input: CustomRoleInput): Promise<CustomRole> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.groups, db.audit, ...permTables()], async () => {
    await requireAdmin(userId);
    const g = await db.groups.get(groupId);
    if (!g || g.deletedAt) throw new ValidationError('Group not found.');
    await checkRoleName(groupId, input.name);
    const r: CustomRole = { ...newMeta(userId), groupId, name: input.name.trim(), description: input.description.trim(), permissions: cleanPerms(input.permissions) };
    await db.roles.add(r);
    await audit(userId, 'role', r.id, 'create', null, `Created position ${r.name} in ${g.name}`);
    return r;
  });
}

export async function updateCustomRole(id: ID, input: CustomRoleInput): Promise<CustomRole> {
  const userId = await currentUserId();
  return db.transaction('rw', [db.audit, ...permTables()], async () => {
    await requireAdmin(userId);
    const before = await db.roles.get(id);
    if (!before || before.deletedAt) throw new ValidationError('Position not found.');
    await checkRoleName(before.groupId, input.name, id);
    const next: CustomRole = { ...before, name: input.name.trim(), description: input.description.trim(), permissions: cleanPerms(input.permissions), updatedAt: nowIso(), updatedBy: userId };
    const changes = diff(before, next, ['name', 'description', 'permissions']);
    if (!changes) return before;
    await db.roles.put(next);
    await audit(userId, 'role', id, 'update', changes, `Updated position ${next.name}`);
    return next;
  });
}

/** Deleting a position also removes it from everyone who held it. */
export async function deleteCustomRole(id: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', [db.audit, ...permTables()], async () => {
    await requireAdmin(userId);
    const r = await db.roles.get(id);
    if (!r || r.deletedAt) return;
    const t = nowIso();
    await db.roles.update(id, { deletedAt: t, updatedAt: t, updatedBy: userId });
    const holders = live(await db.groupAccess.where('groupId').equals(r.groupId).toArray()).filter((a) => a.roleIds.includes(id));
    for (const a of holders) {
      const roleIds = a.roleIds.filter((x) => x !== id);
      await db.groupAccess.put({ ...a, roleIds, deletedAt: roleIds.length ? null : t, updatedAt: t, updatedBy: userId });
    }
    await audit(userId, 'role', id, 'delete', null, `Deleted position ${r.name}${holders.length ? ` (removed from ${holders.length} user${holders.length === 1 ? '' : 's'})` : ''}`);
  });
}

export async function setUserAdmin(targetUserId: ID, admin: boolean) {
  const userId = await currentUserId();
  await db.transaction('rw', [db.audit, ...permTables()], async () => {
    await requireAdmin(userId);
    const u = await db.users.get(targetUserId);
    if (!u || u.deletedAt) throw new ValidationError('User not found.');
    if (!admin) {
      const admins = live(await db.users.toArray()).filter((x) => x.isAdmin);
      if (admins.length === 1 && admins[0].id === targetUserId) throw new ValidationError('There must always be at least one Admin.');
    }
    if (u.isAdmin === admin) return;
    await db.users.put({ ...u, isAdmin: admin, updatedAt: nowIso(), updatedBy: userId });
    await audit(userId, 'user', targetUserId, 'update', { isAdmin: [u.isAdmin, admin] }, admin ? `Made ${u.name} an Admin` : `Removed Admin from ${u.name}`);
  });
}

/* re-export for import module */
export { upsertMembershipTx, normalizeStation, newMeta, audit, requirePerm, requireAdmin, permTables, diff, STATION_KEYS, isValidCall };
