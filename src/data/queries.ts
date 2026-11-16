import { useLiveQuery } from 'dexie-react-hooks';
import { db, live } from './db';
import { callMatchRank } from '../lib/callsign';
import type { Group, ID, Membership, Station } from './types';
import { ALL_PERMISSIONS, BUILT_IN_ROLES, isBuiltInRole, permissionsOf, type Permission, type RoleDef } from './acl';

export interface Directory {
  stations: Station[];
  groups: Group[];
  groupById: Map<ID, Group>;
  membershipsByStation: Map<ID, Membership[]>;
  membershipsByGroup: Map<ID, Membership[]>;
  isAdmin: boolean;
  /** The current user's permissions per group (all permissions everywhere for an Admin). */
  permsByGroup: Map<ID, Set<Permission>>;
  /** The current user's role names per group. */
  rolesByGroup: Map<ID, RoleDef[]>;
}

/** Everything the directory screens need, kept live. */
export function useDirectory(): Directory | undefined {
  return useLiveQuery(async () => {
    const [stations, groups, memberships, meta, customRoles] = await Promise.all([
      db.stations.toArray(), db.groups.toArray(), db.memberships.toArray(), db.meta.get('currentUserId'), db.roles.toArray(),
    ]);
    const uid = meta?.value as string | undefined;
    const user = uid ? await db.users.get(uid) : undefined;
    const isAdmin = !!user && !user.deletedAt && user.isAdmin === true;
    const access = uid ? live(await db.groupAccess.where('userId').equals(uid).toArray()) : [];
    const customById = new Map(live(customRoles).map((r) => [r.id, r]));
    const liveGroups = live(groups).sort((a, b) => a.name.localeCompare(b.name));
    const groupById = new Map(liveGroups.map((g) => [g.id, g]));
    const membershipsByStation = new Map<ID, Membership[]>();
    const membershipsByGroup = new Map<ID, Membership[]>();
    for (const m of live(memberships)) {
      if (!groupById.has(m.groupId)) continue;
      (membershipsByStation.get(m.stationId) ?? membershipsByStation.set(m.stationId, []).get(m.stationId)!).push(m);
      (membershipsByGroup.get(m.groupId) ?? membershipsByGroup.set(m.groupId, []).get(m.groupId)!).push(m);
    }
    return {
      stations: live(stations).sort((a, b) => a.call.localeCompare(b.call)),
      groups: liveGroups,
      groupById,
      membershipsByStation,
      membershipsByGroup,
      isAdmin,
      ...(() => {
        const rolesByGroup = new Map<ID, RoleDef[]>();
        const permsByGroup = new Map<ID, Set<Permission>>();
        for (const a of access) {
          const defs: RoleDef[] = a.roleIds.map((id) => {
            if (isBuiltInRole(id)) return BUILT_IN_ROLES[id];
            const r = customById.get(id);
            return r && r.groupId === a.groupId ? { id: r.id, name: r.name, permissions: r.permissions, builtIn: false, description: r.description } : null;
          }).filter((x): x is RoleDef => !!x);
          rolesByGroup.set(a.groupId, defs);
          permsByGroup.set(a.groupId, permissionsOf(defs));
        }
        if (isAdmin) for (const g of liveGroups) permsByGroup.set(g.id, new Set(ALL_PERMISSIONS));
        return { rolesByGroup, permsByGroup };
      })(),
    };
  });
}

/** Rank stations for a query: call prefix, then suffix, then anywhere in call, then name/city. */
export function searchStations(stations: Station[], raw: string, limit = Infinity): { station: Station; rank: number }[] {
  const q = raw.trim().toUpperCase();
  if (!q) return stations.slice().sort((a, b) => a.call.localeCompare(b.call)).slice(0, limit).map((station) => ({ station, rank: 0 }));
  const out: { station: Station; rank: number }[] = [];
  for (const s of stations) {
    let rank = callMatchRank(s.call, q.replace(/[^A-Z0-9]/g, ''));
    if (rank < 0 && s.previousCalls.some((p) => callMatchRank(p, q) >= 0)) rank = 4;
    if (rank < 0 && [s.name, s.onAirName, s.city, s.county].some((v) => v && v.toUpperCase().includes(q))) rank = 5;
    if (rank >= 0) out.push({ station: s, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || a.station.call.localeCompare(b.station.call)).slice(0, limit);
}

export const stationLocation = (s: Pick<Station, 'city' | 'county' | 'state'>) =>
  [s.city, s.county && (/county|parish|borough/i.test(s.county) ? s.county : `${s.county} Co.`), s.state].filter(Boolean).join(', ');

/** The on-air name, only when it adds something beyond the first word of the full name (e.g. "Bob" for Robert). */
export function distinctOnAirName(s: Pick<Station, 'name' | 'onAirName'>): string {
  if (!s.onAirName) return '';
  const first = s.name.trim().split(/\s+/)[0] ?? '';
  return s.onAirName.toLowerCase() === first.toLowerCase() || s.onAirName.toLowerCase() === s.name.toLowerCase() ? '' : s.onAirName;
}

/** Whether the current user holds a permission in a group. */
export const hasPerm = (dir: Directory, groupId: ID, perm: Permission) => dir.permsByGroup.get(groupId)?.has(perm) ?? false;

/** A short label for the current user's standing in a group. */
export function myRoleLabel(dir: Directory, groupId: ID): string {
  const names = (dir.rolesByGroup.get(groupId) ?? []).map((r) => r.name);
  return dir.isAdmin ? ['Admin', ...names].join(', ') : names.join(', ');
}
