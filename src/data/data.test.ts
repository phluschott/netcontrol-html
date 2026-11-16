import { beforeEach, describe, expect, it } from 'vitest';
import { db, live } from './db';
import {
  addMembership, addStationToGroup, can, createGroup, createStation, currentUserId, deleteGroup, deleteStation,
  ensureLocalUser, findStationByCall, removeMembership, setGroupAccess, updateMembership, updateStation, uuid,
} from './services';
import { applyImport, buildImportPlan, choiceKey, loadPlanContext } from './importPlan';
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
  it('creator owns the group; one station can be in many groups', async () => {
    const sky = await createGroup({ name: 'County Skywarn', type: 'skywarn' });
    const club = await createGroup({ name: 'Radio Club' });
    expect(await can('group.delete', sky.id)).toBe(true);
    const a = await addStationToGroup(sky.id, { call: 'W9ABC', name: 'Sam' }, { roles: ['spotter'], spotterId: 'S-12' });
    const b = await addStationToGroup(club.id, { call: 'w9abc' });
    expect(b.existed).toBe(true);
    expect(b.station.id).toBe(a.station.id);
    expect(live(await db.memberships.where('stationId').equals(a.station.id).toArray())).toHaveLength(2);
    await expect(addMembership(club.id, a.station.id)).rejects.toThrow(/already a member/);
    const m = await updateMembership(a.membership.id, { roles: [] });
    expect(m.roles).toEqual(['member']);
  });
  it('enforces roles', async () => {
    const g = await createGroup({ name: 'ARES' });
    const me = await currentUserId();
    const other = uuid();
    await setGroupAccess(g.id, other, 'viewer');
    expect(await can('members.manage', g.id, other)).toBe(false);
    expect(await can('group.view', g.id, other)).toBe(true);
    await expect(setGroupAccess(g.id, me, 'admin')).rejects.toThrow(/at least one owner/);
    // act as the viewer
    await db.meta.put({ key: 'currentUserId', value: other });
    await expect(addStationToGroup(g.id, { call: 'K9XYZ' })).rejects.toThrow(/permission/);
    await expect(deleteGroup(g.id)).rejects.toThrow(/permission/);
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
    expect(await can('group.delete', g.id)).toBe(true); // original owner restored as current user
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
