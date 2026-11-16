import { db, getMeta, setMeta, TABLES } from './db';
import { audit, currentUserId, nowIso } from './services';

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
  const f = validateBackup(data);
  const keepUser = await getMeta<string>('currentUserId');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
    for (const t of TABLES) {
      const rows = f.tables[t];
      if (Array.isArray(rows) && rows.length) await db.table(t).bulkAdd(rows);
    }
    const users = (f.tables.users ?? []) as { id: string }[];
    if (keepUser && users.some((u) => u.id === keepUser)) await setMeta('currentUserId', keepUser);
  });
  const uid = await currentUserId();
  await audit(uid, 'backup', 'restore', 'restore', null, `Restored backup from ${f.exportedAt}`);
  return { stations: f.tables.stations.length, groups: f.tables.groups.length, memberships: f.tables.memberships.length };
}
