/**
 * Access control.
 *
 * - Admin is global: a flag on the user. An Admin can do everything, everywhere,
 *   and is the only one who manages users, role assignments, and custom positions,
 *   and creates groups.
 * - Everything else is per group. A user holds one or more roles in a group;
 *   their permissions in that group are the union of those roles.
 * - Built-in group roles are fixed. Admins create custom positions per group
 *   from the same permission list.
 * - Every user always has the account-level abilities (own profile, own check-ins,
 *   own messages); those are not group permissions.
 */

export type Permission =
  | 'members.view'
  | 'members.manage'
  | 'stations.edit'
  | 'nets.run'
  | 'nets.editLog'
  | 'nets.configure'
  | 'nets.history'
  | 'group.edit'
  | 'group.delete'
  | 'messages.post'
  | 'messages.moderate'
  | 'boards.manage';

export interface PermissionInfo { label: string; area: string; }

export const PERMISSIONS: Record<Permission, PermissionInfo> = {
  'members.view': { area: 'Members', label: 'View the member list (call sign and name)' },
  'members.manage': { area: 'Members', label: 'Add, edit, remove, and import members' },
  'stations.edit': { area: 'Members', label: "Edit members' station records" },
  'nets.run': { area: 'Nets', label: 'Start and run nets; log check-ins, notes, and reports' },
  'nets.editLog': { area: 'Nets', label: 'Edit or delete check-ins and log entries' },
  'nets.configure': { area: 'Nets', label: 'Set up nets (schedule, script, repeaters)' },
  'nets.history': { area: 'Nets', label: 'View net logs and history; export' },
  'group.edit': { area: 'Group', label: 'Edit group settings' },
  'group.delete': { area: 'Group', label: 'Delete the group' },
  'messages.post': { area: 'Messages', label: 'Post to message boards' },
  'messages.moderate': { area: 'Messages', label: "Moderate: delete or edit others' posts, pin, lock" },
  'boards.manage': { area: 'Messages', label: 'Create and manage message boards' },
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const PERMISSION_AREAS = [...new Set(Object.values(PERMISSIONS).map((p) => p.area))];

export type BuiltInRoleId = 'net_controller' | 'moderator' | 'standard';

export interface RoleDef { id: string; name: string; permissions: Permission[]; builtIn: boolean; description: string }

export const BUILT_IN_ROLES: Record<BuiltInRoleId, RoleDef> = {
  net_controller: {
    id: 'net_controller', name: 'Net Controller', builtIn: true,
    description: 'Everything in the group except managing users and roles.',
    permissions: [...ALL_PERMISSIONS],
  },
  moderator: {
    id: 'moderator', name: 'Moderator', builtIn: true,
    description: 'Message boards and moderation.',
    permissions: ['members.view', 'nets.history', 'messages.post', 'messages.moderate', 'boards.manage'],
  },
  standard: {
    id: 'standard', name: 'Standard User', builtIn: true,
    description: 'Own account and posting messages.',
    permissions: ['members.view', 'nets.history', 'messages.post'],
  },
};
export const BUILT_IN_ROLE_IDS = Object.keys(BUILT_IN_ROLES) as BuiltInRoleId[];
export const isBuiltInRole = (id: string): id is BuiltInRoleId => id in BUILT_IN_ROLES;

/** Union of permissions for a set of role definitions. */
export function permissionsOf(roles: Pick<RoleDef, 'permissions'>[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of r.permissions) out.add(p);
  return out;
}

export class PermissionError extends Error {
  constructor(public perm: Permission | 'admin', public groupId?: string) {
    super(perm === 'admin'
      ? 'Only an Admin can do that.'
      : `You do not have permission to ${PERMISSIONS[perm].label.charAt(0).toLowerCase() + PERMISSIONS[perm].label.slice(1)} in this group.`);
    this.name = 'PermissionError';
  }
}
