import type { GroupRole } from './types';

/**
 * Group-scoped permissions. Every write in services.ts checks one of these.
 * When a server is added, the same matrix becomes its access rules.
 */
export type Permission =
  | 'group.view'
  | 'net.run'
  | 'members.manage'
  | 'group.edit'
  | 'access.manage'
  | 'group.delete';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'group.view': 'View group, members, and history',
  'net.run': 'Run and log nets',
  'members.manage': 'Add, edit, remove members; import',
  'group.edit': 'Edit group settings',
  'access.manage': 'Manage user access',
  'group.delete': 'Delete group',
};

const MATRIX: Record<GroupRole, Permission[]> = {
  owner: ['group.view', 'net.run', 'members.manage', 'group.edit', 'access.manage', 'group.delete'],
  admin: ['group.view', 'net.run', 'members.manage', 'group.edit', 'access.manage'],
  operator: ['group.view', 'net.run'],
  viewer: ['group.view'],
};

export const ROLE_ORDER: GroupRole[] = ['owner', 'admin', 'operator', 'viewer'];

export function roleAllows(role: GroupRole | null | undefined, perm: Permission): boolean {
  return !!role && MATRIX[role].includes(perm);
}

export function permissionsFor(role: GroupRole): Permission[] {
  return MATRIX[role];
}

export class PermissionError extends Error {
  constructor(public perm: Permission, public groupId: string) {
    super(`You do not have permission to ${PERMISSION_LABEL[perm].toLowerCase()} in this group.`);
    this.name = 'PermissionError';
  }
}
