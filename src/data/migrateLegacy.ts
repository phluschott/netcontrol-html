/**
 * One-time import from the earlier single-file app (localStorage key "netcontrol.v2").
 * Each old net becomes a group; its members become memberships; every call sign seen becomes a station.
 * The old data is left in localStorage untouched (session logs are migrated in the nets phase).
 */
import { db, getMeta, setMeta } from './db';
import { addMembership, createGroup, findStationByCall } from './services';
import { createStation } from './services';
import { baseCall, isValidCall } from '../lib/callsign';
import type { GroupType } from './types';

interface LegacyMember { call: string; name?: string; loc?: string }
interface LegacyNet { name: string; type?: string; desc?: string; members?: LegacyMember[]; sessions?: { checkins?: LegacyMember[] }[] }

function groupTypeFor(t = ''): GroupType {
  if (/skywarn/i.test(t)) return 'skywarn';
  if (/emergency|ares/i.test(t)) return 'ares';
  if (/traffic/i.test(t)) return 'traffic';
  return 'club';
}

export async function migrateLegacyIfNeeded(storage: Storage = localStorage): Promise<number> {
  if (await getMeta('legacyMigratedAt')) return 0;
  let data: { nets?: LegacyNet[] } | null = null;
  try { data = JSON.parse(storage.getItem('netcontrol.v2') ?? 'null'); } catch { data = null; }
  if (!data?.nets?.length) { await setMeta('legacyMigratedAt', 'none'); return 0; }

  let groups = 0;
  for (const net of data.nets) {
    const group = await createGroup({ name: net.name || 'Imported net', type: groupTypeFor(net.type), description: net.desc ?? '' });
    groups++;
    const people = new Map<string, LegacyMember>();
    for (const m of net.members ?? []) people.set(baseCall(m.call), m);
    for (const s of net.sessions ?? []) for (const c of s.checkins ?? []) if (!people.has(baseCall(c.call))) people.set(baseCall(c.call), c);
    for (const [call, m] of people) {
      if (!isValidCall(call)) continue;
      const hit = await findStationByCall(call);
      const station = hit?.station ?? (await createStation({ call, name: m.name ?? '', city: m.loc ?? '' }));
      const already = await db.memberships.where('[groupId+stationId]').equals([group.id, station.id]).first();
      if (!already) await addMembership(group.id, station.id);
    }
  }
  await setMeta('legacyMigratedAt', new Date().toISOString());
  return groups;
}
