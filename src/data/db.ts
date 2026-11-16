import Dexie, { type Table } from 'dexie';
import type { AuditEntry, CustomRole, Group, GroupAccess, Membership, MetaKV, Station, User } from './types';

export class NetControlDB extends Dexie {
  stations!: Table<Station, string>;
  groups!: Table<Group, string>;
  memberships!: Table<Membership, string>;
  users!: Table<User, string>;
  groupAccess!: Table<GroupAccess, string>;
  roles!: Table<CustomRole, string>;
  audit!: Table<AuditEntry, string>;
  meta!: Table<MetaKV, string>;

  constructor(name = 'netcontrol') {
    super(name);
    this.version(1).stores({
      stations: 'id, &call, status, *previousCalls',
      groups: 'id, name, type',
      memberships: 'id, &[groupId+stationId], groupId, stationId',
      users: 'id',
      groupAccess: 'id, &[groupId+userId], groupId, userId',
      audit: 'id, at, [entity+entityId], userId',
      meta: 'key',
    });
    // v2: global Admin flag on users; group access holds a list of roles; custom positions per group.
    this.version(2).stores({ roles: 'id, groupId' }).upgrade(async (tx) => {
      const access = await tx.table('groupAccess').toArray();
      const admins = new Set(access.filter((a) => a.role === 'owner' || a.role === 'admin').map((a) => a.userId));
      await tx.table('users').toCollection().modify((u) => { u.isAdmin = admins.has(u.id) || u.isAdmin === true; });
      const map: Record<string, string> = { owner: 'net_controller', admin: 'net_controller', operator: 'net_controller', viewer: 'standard' };
      await tx.table('groupAccess').toCollection().modify((a) => {
        if (!Array.isArray(a.roleIds)) a.roleIds = [map[a.role] ?? 'standard'];
        delete a.role;
      });
    });
  }
}

export const db = new NetControlDB();

export const TABLES = ['stations', 'groups', 'memberships', 'users', 'groupAccess', 'roles', 'audit', 'meta'] as const;
export type TableName = (typeof TABLES)[number];

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
