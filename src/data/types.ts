export type ID = string;

/** Fields every stored record carries, so local data can later sync to a server. */
export interface Meta {
  id: ID;
  createdAt: string;
  createdBy: ID;
  updatedAt: string;
  updatedBy: ID;
  /** Soft delete. Set when removed; rows are kept so deletions can sync. */
  deletedAt: string | null;
}

export type StationStatus = 'active' | 'inactive' | 'sk';
export const STATION_STATUS_LABEL: Record<StationStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  sk: 'Silent Key',
};

export interface StationFields {
  call: string;
  name: string;
  onAirName: string;
  city: string;
  county: string;
  state: string;
  grid: string;
  status: StationStatus;
  notes: string;
  previousCalls: string[];
}
export interface Station extends Meta, StationFields {}

export type GroupType = 'skywarn' | 'club' | 'ares' | 'traffic' | 'other';
export const GROUP_TYPE_LABEL: Record<GroupType, string> = {
  skywarn: 'Skywarn',
  club: 'Club',
  ares: 'ARES / Emergency',
  traffic: 'Traffic (NTS)',
  other: 'Other',
};

export interface GroupFields {
  name: string;
  type: GroupType;
  description: string;
  counties: string[];
  /** Type-specific settings, defined per group type as features are added. */
  settings: Record<string, unknown>;
}
export interface Group extends Meta, GroupFields {}

export type MemberRole = 'member' | 'spotter' | 'ncs' | 'officer';
export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  member: 'Member',
  spotter: 'Spotter',
  ncs: 'Net Control',
  officer: 'Officer',
};
export const MEMBER_ROLES = Object.keys(MEMBER_ROLE_LABEL) as MemberRole[];

export interface MembershipFields {
  roles: MemberRole[];
  spotterId: string;
  active: boolean;
  joinedOn: string; // YYYY-MM-DD or ''
  notes: string;
}
export interface Membership extends Meta, MembershipFields {
  groupId: ID;
  stationId: ID;
}

/** A person who uses the app (not a radio station). */
export interface User extends Meta {
  name: string;
  call: string;
  email: string;
  /** Global Admin: can do everything, and is the only one who manages users and roles. */
  isAdmin: boolean;
}

/** A user's roles in one group. roleIds are built-in role ids (see acl.ts) or CustomRole ids. */
export interface GroupAccess extends Meta {
  groupId: ID;
  userId: ID;
  roleIds: string[];
}

/** A position an Admin defines for one group, built from the permission list. */
export interface CustomRole extends Meta {
  groupId: ID;
  name: string;
  description: string;
  permissions: import('./acl').Permission[];
}

export interface AuditEntry {
  id: ID;
  at: string;
  userId: ID;
  entity: 'station' | 'group' | 'membership' | 'groupAccess' | 'role' | 'user' | 'backup';
  entityId: ID;
  action: 'create' | 'update' | 'delete' | 'restore' | 'import';
  changes: Record<string, [unknown, unknown]> | null;
  summary: string;
}

export interface MetaKV {
  key: string;
  value: unknown;
}
