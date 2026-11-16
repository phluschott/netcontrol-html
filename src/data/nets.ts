/**
 * Roll call nets.
 *
 * Starting a net snapshots the group's active members (active station, active membership)
 * into one check-in row each, in alphabetical call order. Net control works down the list
 * marking each station Checked In, Absent, Skip (to the end of the list), or Silent Key.
 * After the list, late check-ins are taken by call sign; a station not in the group is
 * checked in as a visitor. Ending the net records anyone never answered as Absent.
 *
 * Permissions: nets.run to start a net and to change statuses while it is live;
 * nets.editLog to change or delete anything after it has ended.
 */
import { db, live } from './db';
import {
  audit, createStation, currentUserId, emptyMembership, findStationByCall, newMeta, nowIso, permTables, requirePerm,
  upsertMembershipTx, ValidationError,
} from './services';
import { baseCall, callError } from '../lib/callsign';
import type { Checkin, CheckinStatus, ID, NetSession } from './types';

const netTables = () => [db.sessions, db.checkins, db.stations, db.memberships, db.groups, db.audit, ...permTables()];

async function sessionOrThrow(id: ID): Promise<NetSession> {
  const s = await db.sessions.get(id);
  if (!s || s.deletedAt) throw new ValidationError('Net not found.');
  return s;
}

/** Live nets need nets.run; ended nets need nets.editLog. */
async function requireLogPerm(s: NetSession, userId: ID) {
  await requirePerm(s.endedAt ? 'nets.editLog' : 'nets.run', s.groupId, userId);
}

export async function liveSessionForGroup(groupId: ID): Promise<NetSession | undefined> {
  return live(await db.sessions.where('groupId').equals(groupId).toArray()).find((s) => !s.endedAt);
}

export async function startRollCall(groupId: ID, opts: { title?: string; ncsCall?: string } = {}): Promise<NetSession> {
  const userId = await currentUserId();
  return db.transaction('rw', netTables(), async () => {
    await requirePerm('nets.run', groupId, userId);
    const group = await db.groups.get(groupId);
    if (!group || group.deletedAt) throw new ValidationError('Group not found.');
    const running = await liveSessionForGroup(groupId);
    if (running) throw new ValidationError(`A net is already running for ${group.name}. End it before starting another.`);
    const user = await db.users.get(userId);
    const t = nowIso();
    const session: NetSession = {
      ...newMeta(userId), groupId, kind: 'rollcall',
      title: opts.title?.trim() || `${group.name} Net`,
      startedAt: t, endedAt: null,
      ncsCall: (opts.ncsCall ?? user?.call ?? '').toUpperCase(),
    };
    await db.sessions.add(session);
    const memberships = live(await db.memberships.where('groupId').equals(groupId).toArray()).filter((m) => m.active);
    const stations = (await db.stations.bulkGet(memberships.map((m) => m.stationId)))
      .filter((s): s is NonNullable<typeof s> => !!s && !s.deletedAt && s.status === 'active')
      .sort((a, b) => a.call.localeCompare(b.call));
    await db.checkins.bulkAdd(stations.map((st, i) => ({
      ...newMeta(userId), sessionId: session.id, groupId, stationId: st.id, call: st.call, order: i,
      status: 'pending' as CheckinStatus, statusAt: null, late: false, visitor: false, skips: 0, prevStationStatus: null,
    })));
    await audit(userId, 'session', session.id, 'create', null, `Started ${session.title} (${stations.length} on the roll)`);
    return session;
  });
}

/** Set a station's status. Silent Key also marks the station Silent Key in the directory; changing away from it restores the station. */
export async function setCheckinStatus(checkinId: ID, status: CheckinStatus, restore?: Pick<Checkin, 'order' | 'skips' | 'late' | 'statusAt'>): Promise<Checkin> {
  const userId = await currentUserId();
  return db.transaction('rw', netTables(), async () => {
    const before = await db.checkins.get(checkinId);
    if (!before || before.deletedAt) throw new ValidationError('Check-in not found.');
    const session = await sessionOrThrow(before.sessionId);
    await requireLogPerm(session, userId);
    const t = nowIso();
    const next: Checkin = { ...before, status, statusAt: status === 'pending' ? null : t, updatedAt: t, updatedBy: userId };
    if (status === 'skipped') {
      const rows = await db.checkins.where('sessionId').equals(session.id).toArray();
      next.order = Math.max(...rows.map((r) => r.order)) + 1;
      next.skips = before.skips + 1;
    }
    const station = await db.stations.get(before.stationId);
    if (status === 'sk' && before.status !== 'sk' && station) {
      next.prevStationStatus = station.status;
      if (station.status !== 'sk') {
        await db.stations.put({ ...station, status: 'sk', updatedAt: t, updatedBy: userId });
        await audit(userId, 'station', station.id, 'update', { status: [station.status, 'sk'] }, `Marked ${station.call} Silent Key during ${session.title}`);
      }
    }
    if (before.status === 'sk' && status !== 'sk' && station && station.status === 'sk') {
      const restore = before.prevStationStatus ?? 'active';
      await db.stations.put({ ...station, status: restore, updatedAt: t, updatedBy: userId });
      await audit(userId, 'station', station.id, 'update', { status: ['sk', restore] }, `Undid Silent Key for ${station.call}`);
      next.prevStationStatus = null;
    }
    if (restore) Object.assign(next, restore); // undo: put position, skip count, and time back exactly
    await db.checkins.put(next);
    await audit(userId, 'checkin', next.id, 'update', { status: [before.status, status] }, `${next.call}: ${restore ? 'undo to ' : ''}${status.replace('_', ' ')}`);
    return next;
  });
}

/** Check in a station by call after (or during) the roll call. Members already on the roll are marked late; anyone else is added as a visitor. */
export async function lateCheckIn(sessionId: ID, rawCall: string): Promise<Checkin> {
  const userId = await currentUserId();
  const call = baseCall(rawCall);
  const err = callError(call);
  if (err) throw new ValidationError(err);
  const session = await sessionOrThrow(sessionId);
  await requirePerm(session.endedAt ? 'nets.editLog' : 'nets.run', session.groupId, userId);
  // Create the station outside the net transaction if it is new to the directory.
  const hit = await findStationByCall(call);
  const station = hit ? hit.station : await createStation({ call });
  return db.transaction('rw', netTables(), async () => {
    await requireLogPerm(session, userId);
    const t = nowIso();
    const existing = await db.checkins.where('[sessionId+stationId]').equals([sessionId, station.id]).first();
    if (existing && !existing.deletedAt) {
      if (existing.status === 'checked_in') throw new ValidationError(`${existing.call} is already checked in.`);
      const late = existing.status !== 'pending' || existing.skips > 0 || (await rollCallDone(sessionId, existing.id));
      const next: Checkin = { ...existing, status: 'checked_in', statusAt: t, late, updatedAt: t, updatedBy: userId };
      await db.checkins.put(next);
      await audit(userId, 'checkin', next.id, 'update', { status: [existing.status, 'checked_in'] }, `${next.call}: checked in${late ? ' (late)' : ''}`);
      return next;
    }
    const member = await db.memberships.where('[groupId+stationId]').equals([session.groupId, station.id]).first();
    const rows = await db.checkins.where('sessionId').equals(sessionId).toArray();
    const row: Checkin = {
      ...newMeta(userId), sessionId, groupId: session.groupId, stationId: station.id, call: station.call,
      order: rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 0,
      status: 'checked_in', statusAt: t, late: true, visitor: !member || !!member.deletedAt, skips: 0, prevStationStatus: null,
    };
    if (existing) await db.checkins.delete(existing.id); // a removed row for this station; replace it
    await db.checkins.add(row);
    await audit(userId, 'checkin', row.id, 'create', null, `${row.call}: checked in (late${row.visitor ? ', visitor' : ''})`);
    return row;
  });
}

/** True when every station other than `exceptId` has been called. */
async function rollCallDone(sessionId: ID, exceptId: ID) {
  const rows = live(await db.checkins.where('sessionId').equals(sessionId).toArray());
  return !rows.some((r) => r.id !== exceptId && (r.status === 'pending' || r.status === 'skipped'));
}

/** End the net. Anyone never answered (still waiting or skipped) is recorded as Absent. */
export async function endSession(sessionId: ID): Promise<{ absent: number }> {
  const userId = await currentUserId();
  return db.transaction('rw', netTables(), async () => {
    const s = await sessionOrThrow(sessionId);
    if (s.endedAt) return { absent: 0 };
    await requirePerm('nets.run', s.groupId, userId);
    const t = nowIso();
    const open = live(await db.checkins.where('sessionId').equals(sessionId).toArray()).filter((r) => r.status === 'pending' || r.status === 'skipped');
    for (const r of open) await db.checkins.put({ ...r, status: 'absent', statusAt: t, updatedAt: t, updatedBy: userId });
    await db.sessions.put({ ...s, endedAt: t, updatedAt: t, updatedBy: userId });
    await audit(userId, 'session', s.id, 'update', { endedAt: [null, t] }, `Ended ${s.title}${open.length ? ` (${open.length} never answered, recorded absent)` : ''}`);
    return { absent: open.length };
  });
}

/** Reopen an ended net, e.g. to fix it with late check-ins. Needs nets.editLog. */
export async function reopenSession(sessionId: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', netTables(), async () => {
    const s = await sessionOrThrow(sessionId);
    if (!s.endedAt) return;
    await requirePerm('nets.editLog', s.groupId, userId);
    const running = await liveSessionForGroup(s.groupId);
    if (running) throw new ValidationError('Another net is running for this group. End it first.');
    await db.sessions.put({ ...s, endedAt: null, updatedAt: nowIso(), updatedBy: userId });
    await audit(userId, 'session', s.id, 'update', { endedAt: [s.endedAt, null] }, `Reopened ${s.title}`);
  });
}

/** Remove one check-in row (e.g. checked in by mistake). Needs nets.editLog: Admins and Net Controllers only. */
export async function deleteCheckin(checkinId: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', netTables(), async () => {
    const c = await db.checkins.get(checkinId);
    if (!c || c.deletedAt) return;
    await requirePerm('nets.editLog', c.groupId, userId);
    const t = nowIso();
    await db.checkins.put({ ...c, deletedAt: t, updatedAt: t, updatedBy: userId });
    await audit(userId, 'checkin', c.id, 'delete', null, `Deleted ${c.call} from the log`);
  });
}

/** Delete a whole net and its log. Needs nets.editLog. */
export async function deleteSession(sessionId: ID) {
  const userId = await currentUserId();
  await db.transaction('rw', netTables(), async () => {
    const s = await sessionOrThrow(sessionId);
    await requirePerm('nets.editLog', s.groupId, userId);
    const t = nowIso();
    await db.sessions.put({ ...s, deletedAt: t, updatedAt: t, updatedBy: userId });
    await db.checkins.where('sessionId').equals(sessionId).modify({ deletedAt: t, updatedAt: t, updatedBy: userId });
    await audit(userId, 'session', s.id, 'delete', null, `Deleted ${s.title}`);
  });
}

/** After a net: add visitors who checked in to the group. */
export async function addVisitorsToGroup(sessionId: ID, stationIds: ID[]) {
  const userId = await currentUserId();
  await db.transaction('rw', netTables(), async () => {
    const s = await sessionOrThrow(sessionId);
    await requirePerm('members.manage', s.groupId, userId);
    for (const stationId of stationIds) {
      const { m, created } = await upsertMembershipTx(userId, s.groupId, stationId, emptyMembership());
      if (created) await audit(userId, 'membership', m.id, 'create', null, `Added visitor to the group after ${s.title}`);
    }
  });
}

export function sessionCounts(rows: Checkin[]) {
  const c = { total: rows.length, checkedIn: 0, late: 0, visitors: 0, absent: 0, skipped: 0, pending: 0, sk: 0 };
  for (const r of rows) {
    if (r.status === 'checked_in') { c.checkedIn++; if (r.late) c.late++; if (r.visitor) c.visitors++; }
    else if (r.status === 'absent') c.absent++;
    else if (r.status === 'skipped') c.skipped++;
    else if (r.status === 'pending') c.pending++;
    else if (r.status === 'sk') c.sk++;
  }
  return c;
}

/** Calling order: stations not yet answered (waiting or skipped), by position. The first one is "now calling". */
export function callQueue(rows: Checkin[]): Checkin[] {
  return rows.filter((r) => r.status === 'pending' || r.status === 'skipped').sort((a, b) => a.order - b.order);
}
