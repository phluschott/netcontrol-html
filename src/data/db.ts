import Dexie, { type Table } from 'dexie';
import type { AuditEntry, Group, GroupAccess, Membership, MetaKV, Station, User } from './types';

export class NetControlDB extends Dexie {
  stations!: Table<Station, string>;
  groups!: Table<Group, string>;
  memberships!: Table<Membership, string>;
  users!: Table<User, string>;
  groupAccess!: Table<GroupAccess, string>;
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
  }
}

export const db = new NetControlDB();

export const TABLES = ['stations', 'groups', 'memberships', 'users', 'groupAccess', 'audit', 'meta'] as const;
export type TableName = (typeof TABLES)[number];

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

export const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);
