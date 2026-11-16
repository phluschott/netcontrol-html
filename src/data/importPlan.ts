/**
 * CSV import into a group, in two steps so the operator sees exactly what will happen:
 *   buildImportPlan()  -> a preview: new stations, stations added to the group, already members, conflicts, skipped rows
 *   applyImport()      -> writes it in one transaction, using the operator's per-row conflict choices
 */
import { db, live } from './db';
import { baseCall, callError } from '../lib/callsign';
import { parseCsv } from '../lib/csv';
import {
  audit, currentUserId, emptyMembership, emptyStation, newMeta, normalizeStation, nowIso, requirePerm,
  upsertMembershipTx, diff, STATION_KEYS, permTables,
} from './services';
import { MEMBER_ROLES, MEMBER_ROLE_LABEL, type ID, type MemberRole, type Station, type StationFields } from './types';

export type ImportField = 'call' | 'name' | 'firstName' | 'lastName' | 'onAirName' | 'city' | 'county' | 'state' | 'grid' | 'spotterId' | 'roles' | 'notes';

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  call: 'Call sign', name: 'Name', firstName: 'First name', lastName: 'Last name', onAirName: 'On-air name',
  city: 'City / location', county: 'County', state: 'State', grid: 'Grid', spotterId: 'Spotter ID', roles: 'Roles', notes: 'Notes',
};

const SYNONYMS: Record<ImportField, string[]> = {
  call: ['call', 'callsign', 'callsign1', 'calls', 'station', 'amateurcall'],
  name: ['name', 'fullname', 'operator', 'opname'],
  firstName: ['first', 'firstname', 'fname', 'givenname'],
  lastName: ['last', 'lastname', 'lname', 'surname', 'familyname'],
  onAirName: ['onairname', 'nickname', 'handle', 'goesby', 'airname'],
  city: ['city', 'location', 'town', 'qth', 'loc'],
  county: ['county', 'cnty'],
  state: ['state', 'st', 'province'],
  grid: ['grid', 'gridsquare', 'locator', 'maidenhead'],
  spotterId: ['spotterid', 'spotter', 'spotternumber', 'spotterno', 'skywarnid'],
  roles: ['role', 'roles', 'position'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function mapHeader(cells: string[]): Partial<Record<ImportField, number>> | null {
  const map: Partial<Record<ImportField, number>> = {};
  cells.forEach((cell, i) => {
    const n = norm(cell);
    for (const [field, syns] of Object.entries(SYNONYMS) as [ImportField, string[]][]) {
      if (map[field] === undefined && syns.includes(n)) { map[field] = i; break; }
    }
  });
  return map.call !== undefined ? map : null;
}

export function parseRoles(text: string): MemberRole[] {
  const parts = text.split(/[;,/|]+/).map((p) => norm(p)).filter(Boolean);
  const out = new Set<MemberRole>();
  for (const p of parts) {
    for (const r of MEMBER_ROLES) {
      if (p === r || p === norm(MEMBER_ROLE_LABEL[r]) || (r === 'ncs' && (p === 'netcontrol' || p === 'nc'))) out.add(r);
    }
  }
  return [...out];
}

export type RowStatus = 'new' | 'add' | 'member' | 'invalid' | 'duplicate';
export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  new: 'New station',
  add: 'Add to group',
  member: 'Already a member',
  invalid: 'Skipped: invalid',
  duplicate: 'Skipped: duplicate row',
};

type ProfileField = Exclude<keyof StationFields, 'call' | 'status' | 'notes' | 'previousCalls'>;
const PROFILE_FIELDS: ProfileField[] = ['name', 'onAirName', 'city', 'county', 'state', 'grid'];

export interface Conflict { field: ProfileField; existing: string; incoming: string }

export interface PlanRow {
  line: number;
  rawCall: string;
  call: string;
  status: RowStatus;
  error?: string;
  /** Matched an existing station through one of its previous call signs. */
  viaPrevious?: string;
  stationId?: ID;
  existingCall?: string;
  incoming: Partial<Record<ProfileField, string>> & { notes?: string };
  spotterId: string;
  roles: MemberRole[];
  fills: { field: ProfileField; value: string }[];
  conflicts: Conflict[];
}

export interface ImportPlan {
  hasHeader: boolean;
  columns: { field: ImportField; index: number; header: string }[];
  rows: PlanRow[];
  counts: Record<RowStatus, number> & { conflicts: number };
}

export interface PlanContext {
  /** Live stations keyed by current call. */
  byCall: Map<string, Station>;
  /** Live stations keyed by each previous call. */
  byPrevious: Map<string, Station>;
  /** Station ids with a live membership in the target group. */
  memberIds: Set<ID>;
}

export async function loadPlanContext(groupId: ID): Promise<PlanContext> {
  const stations = live(await db.stations.toArray());
  const byCall = new Map(stations.map((s) => [s.call, s]));
  const byPrevious = new Map<string, Station>();
  for (const s of stations) for (const p of s.previousCalls) byPrevious.set(p, s);
  const memberIds = new Set(live(await db.memberships.where('groupId').equals(groupId).toArray()).map((m) => m.stationId));
  return { byCall, byPrevious, memberIds };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function buildImportPlan(text: string, ctx: PlanContext): ImportPlan {
  const table = parseCsv(text);
  const header = table.length ? mapHeader(table[0]) : null;
  const map: Partial<Record<ImportField, number>> = header ?? { call: 0, name: 1, city: 2 };
  const body = header ? table.slice(1) : table;
  const firstLine = header ? 2 : 1;
  const columns = (Object.entries(map) as [ImportField, number][])
    .sort((a, b) => a[1] - b[1])
    .map(([field, index]) => ({ field, index, header: header ? table[0][index] : `Column ${index + 1}` }));

  const seen = new Set<string>();
  const counts = { new: 0, add: 0, member: 0, invalid: 0, duplicate: 0, conflicts: 0 };
  const rows: PlanRow[] = body.map((cells, i) => {
    const get = (f: ImportField) => (map[f] !== undefined ? cells[map[f]!] ?? '' : '').trim();
    const rawCall = get('call');
    const call = baseCall(rawCall);
    const first = get('firstName'), last = get('lastName');
    const incoming: PlanRow['incoming'] = {
      name: get('name') || [first, last].filter(Boolean).join(' '),
      onAirName: get('onAirName') || (first && (get('name') || last) ? first : ''),
      city: get('city'), county: get('county'), state: get('state').toUpperCase(), grid: get('grid'),
      notes: get('notes'),
    };
    const row: PlanRow = {
      line: firstLine + i, rawCall, call, status: 'new', incoming,
      spotterId: get('spotterId'), roles: parseRoles(get('roles')), fills: [], conflicts: [],
    };
    const err = callError(call);
    if (err) { row.status = 'invalid'; row.error = rawCall ? `"${rawCall}": ${err}` : 'No call sign'; counts.invalid++; return row; }
    if (seen.has(call)) { row.status = 'duplicate'; row.error = `${call} appears earlier in the file`; counts.duplicate++; return row; }
    seen.add(call);

    const station = ctx.byCall.get(call) ?? ctx.byPrevious.get(call);
    if (!station) { counts.new++; return row; }
    if (station.call !== call) row.viaPrevious = call;
    row.stationId = station.id;
    row.existingCall = station.call;
    row.status = ctx.memberIds.has(station.id) ? 'member' : 'add';
    counts[row.status]++;
    // An on-air name guessed from a first-name column is only used for new stations.
    const onAirExplicit = !!get('onAirName');
    for (const f of PROFILE_FIELDS) {
      if (f === 'onAirName' && !onAirExplicit) continue;
      const inc = incoming[f] ?? '';
      if (!inc) continue;
      const cur = station[f] ?? '';
      if (!cur) row.fills.push({ field: f, value: inc });
      else if (!same(cur, inc)) row.conflicts.push({ field: f, existing: cur, incoming: inc });
    }
    counts.conflicts += row.conflicts.length;
    return row;
  });
  return { hasHeader: !!header, columns, rows, counts };
}

/** Key for a per-row, per-field conflict choice. */
export const choiceKey = (line: number, field: string) => `${line}:${field}`;
export type ConflictChoices = Record<string, 'keep' | 'file'>;

export interface ImportResult { created: number; added: number; updated: number; skipped: number }

export async function applyImport(groupId: ID, plan: ImportPlan, choices: ConflictChoices = {}): Promise<ImportResult> {
  const userId = await currentUserId();
  const result: ImportResult = { created: 0, added: 0, updated: 0, skipped: 0 };
  await db.transaction('rw', [db.stations, db.memberships, db.groups, db.audit, ...permTables()], async () => {
    await requirePerm('members.manage', groupId, userId);
    const group = await db.groups.get(groupId);
    if (!group || group.deletedAt) throw new Error('Group not found.');
    const t = nowIso();
    for (const row of plan.rows) {
      if (row.status === 'invalid' || row.status === 'duplicate') { result.skipped++; continue; }
      const membership = { ...emptyMembership(), spotterId: row.spotterId, roles: row.roles.length ? row.roles : ['member' as MemberRole] };

      if (row.status === 'new') {
        // Re-check at write time in case the directory changed since the preview.
        const clash = await db.stations.where('call').equals(row.call).first();
        let station: Station;
        const fields = normalizeStation({ ...emptyStation(row.call), ...stripEmpty(row.incoming) });
        if (clash && !clash.deletedAt) station = clash;
        else if (clash) { station = { ...clash, ...fields, deletedAt: null, updatedAt: t, updatedBy: userId }; await db.stations.put(station); }
        else { station = { ...newMeta(userId), ...fields }; await db.stations.add(station); }
        await audit(userId, 'station', station.id, 'create', null, `Imported ${station.call} into ${group.name}`);
        const { m } = await upsertMembershipTx(userId, groupId, station.id, membership);
        await audit(userId, 'membership', m.id, 'create', null, `Added ${station.call} to ${group.name} (import)`);
        result.created++;
        continue;
      }

      const before = await db.stations.get(row.stationId!);
      if (!before || before.deletedAt) { result.skipped++; continue; }
      const patch: Partial<StationFields> = {};
      for (const f of row.fills) if (!before[f.field]) patch[f.field] = f.value;
      for (const c of row.conflicts) if (choices[choiceKey(row.line, c.field)] === 'file') patch[c.field] = c.incoming;
      if (row.incoming.notes && !before.notes) patch.notes = row.incoming.notes;
      if (Object.keys(patch).length) {
        const next: Station = { ...before, ...normalizeStation({ ...before, ...patch }), updatedAt: t, updatedBy: userId };
        const changes = diff(before, next, STATION_KEYS);
        if (changes) { await db.stations.put(next); await audit(userId, 'station', next.id, 'update', changes, `Updated ${next.call} from import`); result.updated++; }
      }
      if (row.status === 'add') {
        const { m } = await upsertMembershipTx(userId, groupId, before.id, membership);
        await audit(userId, 'membership', m.id, 'create', null, `Added ${before.call} to ${group.name} (import)`);
        result.added++;
      } else {
        const m = await db.memberships.where('[groupId+stationId]').equals([groupId, before.id]).first();
        if (m && !m.deletedAt) {
          const roles = [...new Set([...m.roles, ...row.roles])];
          const spotterId = m.spotterId || row.spotterId;
          if (roles.length !== m.roles.length || spotterId !== m.spotterId) {
            await db.memberships.put({ ...m, roles, spotterId, updatedAt: t, updatedBy: userId });
            await audit(userId, 'membership', m.id, 'update', { roles: [m.roles, roles], spotterId: [m.spotterId, spotterId] }, `Updated ${before.call} membership from import`);
          }
        }
      }
    }
    await audit(userId, 'group', groupId, 'import', null, `Imported ${plan.rows.length} rows: ${result.created} new, ${result.added} added, ${result.updated} updated, ${result.skipped} skipped`);
  });
  return result;
}

function stripEmpty<T extends Record<string, string | undefined>>(o: T): Partial<T> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v) out[k] = v;
  return out as Partial<T>;
}
