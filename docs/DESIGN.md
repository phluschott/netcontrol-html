# Net Control: Design

Status: **Phase 1 (Stations, Groups, Memberships) in progress.** Nets are designed together before any net code is written.

## Goals

- A browser app that a net control operator can rely on during a weekly net and during a severe-weather activation.
- Works with no internet connection once loaded (installable offline web app).
- Built for one operator today, with an access-control structure that is ready for more users later.
- Every station has one record and a full history across every group and net.

## Architecture

| Concern | Choice | Why |
|---|---|---|
| App | Vite + React + TypeScript | Multiple screens and net types need real components; typed data model. |
| Storage | IndexedDB via Dexie | Years of history, indexed queries (call sign prefix/suffix, membership lookups). localStorage is too small and unindexed. |
| Offline | Service worker (vite-plugin-pwa) | Activations happen when power and internet fail. |
| Hosting | Static site (GitHub Pages) | Nothing to install or run. Hash-based routes so any path works on static hosting. |
| Sync (later) | Hosted backend, e.g. Supabase | Only when there are multiple users. IDs are UUIDs and records carry audit fields so local data can sync without rewriting. |
| Backup | Full JSON export and restore | Local data is only as safe as its last backup. |

## Data model

All records have `id` (UUID), `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and `deletedAt` (soft delete, so a later sync can propagate deletions).

### Station
One record per call sign, shared by every group.

| Field | Notes |
|---|---|
| `call` | Unique, uppercase, the current call sign. |
| `name`, `onAirName` | Full name; the name net control uses on the air. |
| `city`, `county`, `state`, `grid` | Location. |
| `status` | `active`, `inactive`, `sk` (Silent Key). SK stations are kept for history and never appear on roll call. |
| `notes` | Standing notes that are true every week ("mobile most Tuesdays", "relays via K9XYZ"). |
| `previousCalls` | Earlier call signs, so history follows a call sign change. |

Call sign rule: 3–8 letters and digits, at least one of each (covers 1x1 special event calls such as K9A). A portable suffix such as `/M` or `/P` is not part of the station identity; it belongs on the individual check-in (nets phase).

### Group
A Skywarn team, club, ARES unit, traffic net, etc.

| Field | Notes |
|---|---|
| `name`, `type` | Type: `skywarn`, `club`, `ares`, `traffic`, `other`. Type decides which net screens a group can run. |
| `description`, `counties` | Counties served. |
| `settings` | Type-specific settings (for Skywarn later: report criteria). |

### Membership
A station's membership in a group. Unlimited per station.

| Field | Notes |
|---|---|
| `groupId`, `stationId` | Unique together. |
| `roles` | Any of `member`, `spotter`, `ncs` (qualified net control), `officer`. |
| `spotterId` | Optional Skywarn spotter number. |
| `active`, `joinedOn`, `notes` | Inactive members stay on record but drop off roll call. |

**CSV import into a group** never duplicates a station. Each row is matched by call sign:
- new call sign → new station + membership;
- existing station, not in group → membership added;
- already a member → no change.

If the file's name or location differs from what is on file, the preview shows both and the operator chooses, per row, to keep what is on file (default) or take the file's value. Blank fields on file are filled from the file. Invalid and duplicate rows are listed and skipped.

### Users and access control (ready for multiple users)
Users are people who use the app; stations are radio stations. A user may be linked to a station.

| Record | Fields |
|---|---|
| `User` | `name`, `call` (optional), `email` (optional) |
| `GroupAccess` | `groupId`, `userId`, `role` |
| `AuditEntry` | `at`, `userId`, `entity`, `entityId`, `action`, `changes` |

Group roles and permissions:

| Permission | owner | admin | operator | viewer |
|---|---|---|---|---|
| View group, members, history | ✓ | ✓ | ✓ | ✓ |
| Run and log nets *(nets phase)* | ✓ | ✓ | ✓ | |
| Add, edit, remove members; import | ✓ | ✓ | | |
| Edit group settings | ✓ | ✓ | | |
| Manage user access | ✓ | ✓ | | |
| Delete group | ✓ | | | |

Stations are shared across groups. A user may edit a station if they hold `admin` or higher in any group the station belongs to, or created it. Every write goes through one service layer that checks permissions and records an audit entry, so the same rules can later be enforced server-side.

Today there is one local user, created on first run, who owns every group they create.

### Nets, sessions, log entries
**To be designed together before implementation.** Known requirements so far:
- A net belongs to a group; group type decides the available net screens.
- Check-in net screen differs from a Skywarn activation screen.
- Skywarn reports need a "Relayed to NWS?" checkbox (the person beside net control relays; the app does not contact NWS).
- Station page will show every check-in, note, and storm report for that station.

## Screens (Phase 1)

- **Stations**: searchable directory (call sign prefix, suffix, or name), status, group memberships.
- **Station page**: details, standing notes, previous calls, memberships (add/remove, roles, spotter ID, active). Activity section reserved for the nets phase.
- **Groups**: list with type and member counts.
- **Group page**: details, members table, add member (from directory or new), CSV import with preview, members CSV export, access list.
- **Search** (Ctrl+K): jump to any station or group.
- **Settings**: backup, restore, current user.

## Migration from the single-file version

On first run, data saved by the earlier single-file version in the same browser (`netcontrol.v2`) is imported: each old net becomes a group with its members as memberships; every call sign seen becomes a station. Old session logs stay in the browser untouched and will be migrated in the nets phase. The single-file version is kept at `legacy/index.html`.
