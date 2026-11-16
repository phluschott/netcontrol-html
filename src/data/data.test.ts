import { beforeEach, describe, expect, it } from 'vitest';
import { db, live } from './db';
import {
  addMembership, addStationToGroup, can, createGroup, createStation, currentUserId, deleteGroup, deleteStation,
  ensureLocalUser, findStationByCall, removeMembership, assignRoles, createCustomRole, deleteCustomRole, groupPermissions, isAdmin, setUserAdmin, updateGroup, updateMembership, updateStation,
} from './services';
import { applyImport, buildImportPlan, choiceKey, loadPlanContext, sampleCsvRows } from './importPlan';
import { exportAll, restoreAll } from './backup';
import { migrateLegacyIfNeeded } from './migrateLegacy';
import { baseCall, callError, callMatchRank } from '../lib/callsign';
import { parseCsv, toCsv } from '../lib/csv';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureLocalUser();
});

describe('call signs', () => {
  it('validates identity', () => {
    expect(callError('K9TWX')).toBeNull();
    expect(callError('K9A')).toBeNull();
    expect(callError('KD9ABCDE')).toBeNull();
    expect(callError('KK')).not.toBeNull();
    expect(callError('ABCDEF')).not.toBeNull(); // no digit
    expect(callError('123456')).not.toBeNull(); // no letter
    expect(callError('KD9ABCDEF')).not.toBeNull(); // 9 chars
  });
  it('strips portable suffixes and prefixes', () => {
    expect(baseCall('k9twx/m')).toBe('K9TWX');
    expect(baseCall('VE3/K9TWX')).toBe('K9TWX');
    expect(baseCall(' w9 abc ')).toBe('W9ABC');
  });
  it('ranks prefix before suffix before contains', () => {
    expect(callMatchRank('W9ABC', 'W9')).toBe(1);
    expect(callMatchRank('W9ABC', 'ABC')).toBe(2);
    expect(callMatchRank('W9ABC', '9A')).toBe(3);
    expect(callMatchRank('W9ABC', 'XYZ')).toBe(-1);
  });
});

describe('csv', () => {
  it('parses quotes, embedded commas, CRLF, BOM, and blank lines', () => {
    const rows = parseCsv('﻿call,name\r\n"W9ABC","Smith, Sam"\r\n\r\nK9XYZ,"He said ""hi"""\n');
    expect(rows).toEqual([['call', 'name'], ['W9ABC', 'Smith, Sam'], ['K9XYZ', 'He said "hi"']]);
  });
  it('detects tabs and semicolons', () => {
    expect(parseCsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a;b\nc;d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('round-trips', () => {
    const data = [['W9ABC', 'Smith, Sam', 'say "hi"']];
    expect(parseCsv(toCsv(data))).toEqual(data);
  });
});

describe('stations', () => {
  it('rejects duplicate calls and keeps history on call change', async () => {
    const s = await createStation({ call: 'kd9old', name: 'Pat' });
    expect(s.call).toBe('KD9OLD');
    await expect(createStation({ call: 'KD9OLD' })).rejects.toThrow(/already/);
    const renamed = await updateStation(s.id, { call: 'K9NEW' });
    expect(renamed.previousCalls).toEqual(['KD9OLD']);
    expect((await findStationByCall('KD9OLD'))?.station.id).toBe(s.id);
    await expect(createStation({ call: 'KD9OLD' })).rejects.toThrow(/previous call sign of K9NEW/);
  });
  it('blocks deleting a station that has memberships', async () => {
    const g = await createGroup({ name: 'Club' });
    const { station, membership } = await addStationToGroup(g.id, { call: 'W9ABC' });
    await expect(deleteStation(station.id)).rejects.toThrow(/member of 1 group/);
    await removeMembership(membership.id);
    await deleteStation(station.id);
    expect(await findStationByCall('W9ABC')).toBeNull();
    // Re-adding the call revives the same record instead of failing the unique index.
    const again = await createStation({ call: 'W9ABC' });
    expect(again.id).toBe(station.id);
  });
});

describe('groups, memberships, access', () => {
  it('one station can be in many groups', async () => {
    const sky = await createGroup({ name: 'County Skywarn', type: 'skywarn' });
    const club = await createGroup({ name: 'Radio Club' });
    expect(await can('group.delete', sky.id)).toBe(true); // local user is the Admin
    const a = await addStationToGroup(sky.id, { call: 'W9ABC', name: 'Sam' }, { roles: ['spotter'], spotterId: 'S-12' });
    const b = await addStationToGroup(club.id, { call: 'w9abc' });
    expect(b.existed).toBe(true);
    expect(b.station.id).toBe(a.station.id);
    expect(live(await db.memberships.where('stationId').equals(a.station.id).toArray())).toHaveLength(2);
    await expect(addMembership(club.id, a.station.id)).rejects.toThrow(/already a member/);
    const m = await updateMembership(a.membership.id, { roles: [] });
    expect(m.roles).toEqual(['member']);
  });
  it('deleting a group removes its memberships but keeps stations', async () => {
    const g = await createGroup({ name: 'Temp' });
    const { station } = await addStationToGroup(g.id, { call: 'K9XYZ' });
    await deleteGroup(g.id);
    expect(live(await db.memberships.where('groupId').equals(g.id).toArray())).toHaveLength(0);
    expect((await findStationByCall('K9XYZ'))?.station.id).toBe(station.id);
  });
});

describe('csv import', () => {
  it('plans new / add / member / conflicts / invalid / duplicate / previous call', async () => {
    const g = await createGroup({ name: 'Skywarn', type: 'skywarn' });
    const other = await createGroup({ name: 'Club' });
    await addStationToGroup(g.id, { call: 'W9MEM', name: 'Mem', city: '' });
    await addStationToGroup(other.id, { call: 'K9EXT', name: 'Robert Jones', city: 'Peoria' });
    const renamed = await createStation({ call: 'KD9OLD' });
    await updateStation(renamed.id, { call: 'K9REN' });

    const csv = [
      'Call Sign,First Name,Last Name,City,County,Spotter ID,Role',
      'W9NEW,Ann,Lee,Joliet,Will,S-1,Spotter',
      'K9EXT,Bob,Jones,Pekin,Tazewell,,',
      'w9mem,,,Elgin,,,"spotter;ncs"',
      'KD9OLD,,,,,,',
      'BADCALL,,,,,,',
      'W9NEW,,,,,,',
    ].join('\n');
    const plan = buildImportPlan(csv, await loadPlanContext(g.id));
    expect(plan.hasHeader).toBe(true);
    expect(plan.rows.map((r) => r.status)).toEqual(['new', 'add', 'member', 'add', 'invalid', 'duplicate']);
    const ext = plan.rows[1];
    expect(ext.conflicts.map((c) => c.field).sort()).toEqual(['city', 'name']);
    expect(ext.fills.map((f) => f.field).sort()).toEqual(['county']); // on-air name guessed from First Name is not applied to existing stations
    expect(plan.rows[2].fills).toEqual([{ field: 'city', value: 'Elgin' }]);
    expect(plan.rows[3].viaPrevious).toBe('KD9OLD');
    expect(plan.rows[3].existingCall).toBe('K9REN');
    expect(plan.rows[0].incoming.name).toBe('Ann Lee');
    expect(plan.rows[0].incoming.onAirName).toBe('Ann');

    const res = await applyImport(g.id, plan, { [choiceKey(ext.line, 'city')]: 'file' });
    expect(res).toEqual({ created: 1, added: 2, updated: 2, skipped: 2 });

    const extSt = (await findStationByCall('K9EXT'))!.station;
    expect(extSt.city).toBe('Pekin'); // chose file
    expect(extSt.name).toBe('Robert Jones'); // kept existing
    expect(extSt.county).toBe('Tazewell'); // filled blank
    const newSt = (await findStationByCall('W9NEW'))!.station;
    const newM = await db.memberships.where('[groupId+stationId]').equals([g.id, newSt.id]).first();
    expect(newM?.roles).toEqual(['spotter']);
    expect(newM?.spotterId).toBe('S-1');
    const mem = (await findStationByCall('W9MEM'))!.station;
    const memM = await db.memberships.where('[groupId+stationId]').equals([g.id, mem.id]).first();
    expect(memM?.roles.sort()).toEqual(['member', 'ncs', 'spotter']);
    // K9EXT is now in both groups, one station record.
    expect(live(await db.memberships.where('stationId').equals(extSt.id).toArray())).toHaveLength(2);
    expect(live(await db.stations.toArray()).map((x) => x.call).sort()).toEqual(['K9EXT', 'K9REN', 'W9MEM', 'W9NEW']);
  });
  it('sample CSV maps every column and its example rows are never imported', async () => {
    const g = await createGroup({ name: 'Skywarn' });
    const rows = sampleCsvRows();
    const filled = [...rows, ['W9REAL', 'Real', 'Person', '', 'Hardin', 'Calhoun', 'IL', '', 'S-7', 'Spotter', '']];
    const plan = buildImportPlan(toCsv(filled), await loadPlanContext(g.id));
    expect(plan.columns).toHaveLength(rows[0].length);
    expect(plan.rows.map((r) => [r.call, r.status])).toEqual([['N0CALL', 'invalid'], ['N1CALL', 'invalid'], ['W9REAL', 'new']]);
    expect(plan.rows[0].error).toMatch(/Example row/);
    expect(plan.rows[2].roles).toEqual(['spotter']);
  });
  it('accepts a headerless list of calls', async () => {
    const g = await createGroup({ name: 'Club' });
    const plan = buildImportPlan('W9AAA,Al,Peoria\nW9BBB\n', await loadPlanContext(g.id));
    expect(plan.hasHeader).toBe(false);
    expect(plan.rows.map((r) => [r.call, r.incoming.name, r.incoming.city])).toEqual([['W9AAA', 'Al', 'Peoria'], ['W9BBB', '', '']]);
  });
});

describe('backup', () => {
  it('round-trips everything', async () => {
    const g = await createGroup({ name: 'Club' });
    await addStationToGroup(g.id, { call: 'W9ABC' });
    const file = JSON.parse(JSON.stringify(await exportAll()));
    await db.delete(); await db.open(); await ensureLocalUser();
    const res = await restoreAll(file);
    expect(res).toEqual({ stations: 1, groups: 1, memberships: 1 });
    expect(await isAdmin()).toBe(true); // original Admin restored as current user
  });
  it('restores a backup made before positions existed without losing Admin', async () => {
    const g = await createGroup({ name: 'Club' });
    const file = JSON.parse(JSON.stringify(await exportAll()));
    // simulate the old format: owner role on access, no isAdmin flag, no roles table
    const me = await currentUserId();
    file.tables.users = file.tables.users.map(({ isAdmin: _x, ...u }: Record<string, unknown>) => u);
    file.tables.groupAccess = [{ id: 'a1', groupId: g.id, userId: me, role: 'owner', createdAt: '', createdBy: me, updatedAt: '', updatedBy: me, deletedAt: null }];
    delete file.tables.roles;
    await db.delete(); await db.open(); await ensureLocalUser();
    await restoreAll(file);
    expect(await isAdmin()).toBe(true);
    expect((await db.groupAccess.get('a1'))?.roleIds).toEqual(['net_controller']);
  });
  it('rejects other files', async () => {
    await expect(restoreAll({ foo: 1 })).rejects.toThrow(/not a Net Control backup/);
  });
});

describe('legacy migration', () => {
  it('turns old nets into groups and members into memberships, once', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null } as Storage;
    store.set('netcontrol.v2', JSON.stringify({ nets: [
      { name: 'Tuesday Skywarn', type: 'Skywarn', members: [{ call: 'W9ABC', name: 'Sam', loc: 'Peoria' }], sessions: [{ checkins: [{ call: 'K9XYZ/M' }] }] },
      { name: 'Club Net', type: 'Social / Ragchew', members: [{ call: 'W9ABC' }] },
    ] }));
    expect(await migrateLegacyIfNeeded(storage)).toBe(2);
    expect(await migrateLegacyIfNeeded(storage)).toBe(0);
    const groups = live(await db.groups.toArray());
    expect(groups.map((x) => x.type).sort()).toEqual(['club', 'skywarn']);
    expect(live(await db.stations.toArray()).map((s) => s.call).sort()).toEqual(['K9XYZ', 'W9ABC']);
    expect(live(await db.memberships.toArray())).toHaveLength(3);
  });
});

/* ---------------- access control ---------------- */
import type { User } from './types';
import { NetControlDB } from './db';
import Dexie from 'dexie';

async function addUser(name: string): Promise<string> {
  const id = crypto.randomUUID(); const t = new Date().toISOString();
  const u: User = { id, createdAt: t, createdBy: id, updatedAt: t, updatedBy: id, deletedAt: null, name, call: '', email: '', isAdmin: false };
  await db.users.add(u);
  return id;
}
const actAs = (id: string) => db.meta.put({ key: 'currentUserId', value: id });

describe('access control', () => {
  it('first local user is the global Admin; Admin alone creates groups and manages roles', async () => {
    const admin = await currentUserId();
    expect(await isAdmin(admin)).toBe(true);
    const g = await createGroup({ name: 'Skywarn' });
    const nc = await addUser('Nora');
    await assignRoles(g.id, nc, ['net_controller']);
    await actAs(nc);
    expect(await isAdmin()).toBe(false);
    await expect(createGroup({ name: 'Another' })).rejects.toThrow(/Only an Admin/);
    await expect(assignRoles(g.id, nc, ['net_controller', 'moderator'])).rejects.toThrow(/Only an Admin/);
    await expect(createCustomRole(g.id, { name: 'Liaison', description: '', permissions: [] })).rejects.toThrow(/Only an Admin/);
  });

  it('Net Controller can do everything in the group except user and role management', async () => {
    const g = await createGroup({ name: 'Skywarn' });
    const other = await createGroup({ name: 'Club' });
    const nc = await addUser('Nora');
    await assignRoles(g.id, nc, ['net_controller']);
    await actAs(nc);
    const { station } = await addStationToGroup(g.id, { call: 'W9ABC' });
    await updateStation(station.id, { name: 'Sam' });
    await updateGroup(g.id, { description: 'Edited by NC' });
    // no rights in a group they hold no role in
    await expect(addStationToGroup(other.id, { call: 'K9XYZ' })).rejects.toThrow(/permission/);
    await deleteGroup(g.id);
  });

  it('Moderator and Standard User cannot manage members; permissions follow the role table', async () => {
    const g = await createGroup({ name: 'Club' });
    const mod = await addUser('Max'); const std = await addUser('Stu');
    await assignRoles(g.id, mod, ['moderator']);
    await assignRoles(g.id, std, ['standard']);
    expect([...(await groupPermissions(g.id, mod))].sort()).toEqual(['boards.manage', 'members.view', 'messages.moderate', 'messages.post', 'nets.history']);
    expect([...(await groupPermissions(g.id, std))].sort()).toEqual(['members.view', 'messages.post', 'nets.history']);
    await actAs(mod);
    await expect(addStationToGroup(g.id, { call: 'K9XYZ' })).rejects.toThrow(/permission/);
    await actAs(std);
    await expect(updateGroup(g.id, { description: 'x' })).rejects.toThrow(/permission/);
  });

  it('custom positions are per group, combine with other roles, and are removed from holders when deleted', async () => {
    const g = await createGroup({ name: 'Skywarn' });
    const other = await createGroup({ name: 'Club' });
    const roster = await createCustomRole(g.id, { name: 'Roster Keeper', description: 'Keeps the member list', permissions: ['members.manage', 'members.view'] });
    await expect(createCustomRole(g.id, { name: 'roster keeper', description: '', permissions: [] })).rejects.toThrow(/already a position/);
    await expect(createCustomRole(g.id, { name: 'Moderator', description: '', permissions: [] })).rejects.toThrow(/already a position/);
    await expect(assignRoles(other.id, await currentUserId(), [roster.id])).rejects.toThrow(/Unknown role/);
    const u = await addUser('Ray');
    await assignRoles(g.id, u, [roster.id, 'moderator']);
    expect(await can('members.manage', g.id, u)).toBe(true);
    expect(await can('messages.moderate', g.id, u)).toBe(true);
    expect(await can('group.edit', g.id, u)).toBe(false);
    await deleteCustomRole(roster.id);
    expect(await can('members.manage', g.id, u)).toBe(false);
    expect(await can('messages.moderate', g.id, u)).toBe(true);
  });

  it('there is always at least one Admin', async () => {
    await expect(setUserAdmin(await currentUserId(), false)).rejects.toThrow(/at least one Admin/);
    const u = await addUser('Second');
    await setUserAdmin(u, true);
    await setUserAdmin(await currentUserId(), false);
    expect(await isAdmin(u)).toBe(true);
  });

  it('upgrades data saved under the earlier owner/admin/operator/viewer roles', async () => {
    const name = 'upgrade-test';
    await Dexie.delete(name);
    const v1 = new Dexie(name);
    v1.version(1).stores({ stations: 'id, &call, status, *previousCalls', groups: 'id, name, type', memberships: 'id, &[groupId+stationId], groupId, stationId', users: 'id', groupAccess: 'id, &[groupId+userId], groupId, userId', audit: 'id, at, [entity+entityId], userId', meta: 'key' });
    await v1.open();
    await v1.table('users').bulkAdd([{ id: 'u1', name: 'Owner' }, { id: 'u2', name: 'Viewer' }]);
    await v1.table('groupAccess').bulkAdd([{ id: 'a1', groupId: 'g1', userId: 'u1', role: 'owner' }, { id: 'a2', groupId: 'g1', userId: 'u2', role: 'viewer' }]);
    v1.close();
    const v2 = new NetControlDB(name);
    await v2.open();
    expect((await v2.users.get('u1'))?.isAdmin).toBe(true);
    expect((await v2.users.get('u2'))?.isAdmin).toBe(false);
    expect((await v2.groupAccess.get('a2'))?.roleIds).toEqual(['standard']);
    expect((await v2.groupAccess.get('a1')) as unknown as { role?: string }).not.toHaveProperty('role');
    v2.close();
  });
});
