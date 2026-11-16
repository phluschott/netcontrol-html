import { db, getMeta, setMeta, TABLES } from './db';
import { audit, currentUserId, nowIso } from './services';
import { decryptJson, encryptJson, generatePassword, isEncryptedEnvelope } from '../lib/crypto';


export interface BackupFile {
  app: 'netcontrol';
  format: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  const exportedAt = nowIso();
  // Record the backup time first so the file itself carries it.
  await setMeta('lastBackupAt', exportedAt);
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await db.table(t).toArray();
  return { app: 'netcontrol', format: 1, exportedAt, tables };
}

export function validateBackup(data: unknown): BackupFile {
  const f = data as BackupFile;
  if (!f || f.app !== 'netcontrol' || f.format !== 1 || typeof f.tables !== 'object') {
    throw new Error('This file is not a Net Control backup.');
  }
  for (const t of ['stations', 'groups', 'memberships']) {
    if (!Array.isArray(f.tables[t])) throw new Error(`The backup is missing ${t}.`);
  }
  return f;
}

/** Replace everything in this browser with the backup. The current user is kept signed in if present in the backup. */
export async function restoreAll(data: unknown): Promise<{ stations: number; groups: number; memberships: number }> {
  const f = upgradeBackup(validateBackup(data));
  const keepUser = await getMeta<string>('currentUserId');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
    for (const t of TABLES) {
      const rows = f.tables[t];
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkAdd(rows);
    }
    const users = (f.tables.users ?? []) as { id: string; isAdmin?: boolean; deletedAt?: string | null }[];
    if (keepUser && users.some((u) => u.id === keepUser)) await setMeta('currentUserId', keepUser);
    // Never leave the app without an Admin: if the backup has none, the person restoring becomes Admin.
    if (!users.some((u) => u.isAdmin && !u.deletedAt)) {
      const me = (await getMeta<string>('currentUserId')) ?? users[0]?.id;
      if (me && (await db.users.get(me))) await db.users.update(me, { isAdmin: true });
    }
  });
  const uid = await currentUserId();
  await audit(uid, 'backup', 'restore', 'restore', null, `Restored backup from ${f.exportedAt}`);
  return { stations: f.tables.stations.length, groups: f.tables.groups.length, memberships: f.tables.memberships.length };
}

/** Bring backups made before positions existed (owner/admin/operator/viewer roles) up to date. */
function upgradeBackup(f: BackupFile): BackupFile {
  const access = (f.tables.groupAccess ?? []) as Record<string, unknown>[];
  const users = (f.tables.users ?? []) as Record<string, unknown>[];
  const admins = new Set(access.filter((a) => a.role === 'owner' || a.role === 'admin').map((a) => a.userId));
  const map: Record<string, string> = { owner: 'net_controller', admin: 'net_controller', operator: 'net_controller', viewer: 'standard' };
  return {
    ...f,
    tables: {
      ...f.tables,
      users: users.map((u) => ({ ...u, isAdmin: u.isAdmin === true || admins.has(u.id) })),
      groupAccess: access.map(({ role, ...a }) => ({ ...a, roleIds: Array.isArray(a.roleIds) ? a.roleIds : [map[role as string] ?? 'standard'] })),
      roles: f.tables.roles ?? [],
      sessions: f.tables.sessions ?? [],
      checkins: f.tables.checkins ?? [],
    },
  };
}

/* ---------------- encrypted backups ---------------- */

export interface BackupHistoryEntry { id: string; createdAt: string; fileName: string; password: string }
const HISTORY_KEY = 'backupHistory';
const HISTORY_MAX = 50;

/** Past encrypted backups made in this browser, newest first, with their passwords. */
export async function backupHistory(): Promise<BackupHistoryEntry[]> {
  return (await getMeta<BackupHistoryEntry[]>(HISTORY_KEY)) ?? [];
}

/** Build an encrypted backup of everything. Returns the file contents and its generated password. */
export async function createEncryptedBackup(): Promise<{ fileName: string; text: string; password: string; id: string }> {
  const id = generatePassword().slice(0, 4);
  const password = generatePassword();
  const createdAt = nowIso();
  const fileName = `netcontrol-backup-${createdAt.slice(0, 10)}-${id}.ncbackup`;
  // Record the entry before exporting so this backup's own history travels inside it.
  const history = [{ id, createdAt, fileName, password }, ...(await backupHistory())].slice(0, HISTORY_MAX);
  await setMeta(HISTORY_KEY, history);
  const plain = await exportAll();
  const envelope = await encryptJson(plain, password, id, createdAt);
  return { fileName, text: JSON.stringify(envelope), password, id };
}

/** What a chosen file is, before restoring it. */
export function inspectBackupText(text: string): { encrypted: true; id: string; createdAt: string } | { encrypted: false; createdAt: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not a Net Control backup.'); }
  if (isEncryptedEnvelope(data)) return { encrypted: true, id: data.id, createdAt: data.createdAt };
  return { encrypted: false, createdAt: validateBackup(data).exportedAt };
}

/** Restore from file text; encrypted files need their password. */
export async function restoreFromText(text: string, password?: string) {
  const data: unknown = JSON.parse(text);
  if (isEncryptedEnvelope(data)) {
    if (!password) throw new Error('This backup is encrypted. Enter its password.');
    return restoreAll(await decryptJson(data, password));
  }
  return restoreAll(data);
}
