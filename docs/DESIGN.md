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
| Sync (not planned now) | Hosted backend, e.g. Supabase | Only if live sharing is ever needed. IDs are UUIDs and records carry audit fields so local data could sync without rewriting. |
| Backup and sharing | Encrypted backup file (AES-256-GCM, key from a generated 20-character password via PBKDF2-SHA-256, 600,000 iterations) | Local data is only as safe as its last backup. Data is shared between net controllers by sending the file and, separately, its password. No live sharing for now. |

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
| `User` | `name`, `call` (optional), `email` (optional), `isAdmin` |
| `GroupAccess` | `groupId`, `userId`, `roleIds` (one or more) |
| `CustomRole` | `groupId`, `name`, `description`, `permissions` |
| `AuditEntry` | `at`, `userId`, `entity`, `entityId`, `action`, `changes` |

**Rules**
- **Admin is global.** An Admin can do everything in every group. Only an Admin creates groups, manages users, assigns positions, and creates custom positions. There is always at least one Admin.
- **Everything else is per group.** A user holds one or more positions in a group; their permissions there are the union of those positions. No per-net permissions.
- **Built-in positions are fixed.** Admins create custom positions per group from the permission list below. User and position management can never be given to a position.
- **Everyone** can edit their own profile, see their own check-ins, and delete their own messages (account level, not a group permission).

| Permission | Net Controller | Moderator | Standard User |
|---|:-:|:-:|:-:|
| View the member list (call sign and name) | ✓ | ✓ | ✓ |
| Add, edit, remove, and import members | ✓ | | |
| Edit members' station records | ✓ | | |
| Start and run nets; log check-ins, notes, and reports | ✓ | | |
| Edit or delete check-ins and log entries | ✓ | | |
| Set up nets (schedule, script, repeaters) | ✓ | | |
| View net logs and history; export | ✓ | ✓ | ✓ |
| Edit group settings | ✓ | | |
| Delete the group | ✓ | | |
| Post to message boards | ✓ | ✓ | ✓ |
| Moderate messages (delete or edit others' posts, pin, lock) | ✓ | ✓ | |
| Create and manage message boards | ✓ | ✓ | |

Standard Users never see other members' contact details. Every write goes through one service layer that checks permissions and records an audit entry, so the same rules can later be enforced server-side.

Today there is one local user, who is the Admin.

### Nets

Two kinds of net, built one at a time: **roll call nets** (built) and **net activations** for severe weather (to be designed next).

#### Roll call net (built)
How a normal check-in net runs: net control calls each member; the member answers with their call; they are checked in.

- **Start Net** (group page, `nets.run`): the group's active members on active stations are put on the roll in alphabetical call order. Inactive members and Silent Key stations are left off.
- **Now Calling** shows the call, name, location, and standing notes, with four buttons (keyboard in brackets):
  - **Checked In** [C]: time-stamped.
  - **Absent** [A]: no answer; can still check in late.
  - **Skip** [S]: moves the station to the end of the list to be called again; flagged "Skipped once/n×".
  - **Silent Key** [K]: after confirming, also marks the station Silent Key in the directory so it is never called again. Undo restores the station.
  - **Undo** [U] puts the last station back exactly as it was (status, position, time).
- **Late check-ins / missed calls**: a call box with type-ahead (prefix or suffix). Stations on this net's roll who have not checked in come first, then the rest of the directory, then "new station". A station not in the group is checked in as a **visitor**; a new call is added to the directory.
- **Not Checked In** tab: everyone not checked in, alphabetical, each with a Check In button. Also **Checked In** (with times, Late, Visitor) and **Log** (every station, status editable).
- **End Net**: anyone never answered (not called or skipped) is recorded Absent. The summary offers to add visitors to the group.
- **After the net**: Admins and Net Controllers (`nets.editLog`) can change statuses, delete a check-in, reopen, or delete the net. Every change is in the change log. Standard Users can never delete a check-in.
- **Where it shows up**: group page Nets panel (start, resume live, past nets), a LIVE button in the header while a net runs, each station's Net Activity, and the member box on the group page.

Data: `NetSession` (group, title, net control call, start, end) and one `Checkin` per station per net (call at the time, position, status, time, late, visitor, skip count).

#### Still to design
- Net activations (severe weather): levels, spotter tracking, storm reports with a "Relayed to NWS?" checkbox (the person beside net control relays; the app does not contact NWS).
- Net definitions with schedule, script/preamble, and repeater (see WISHLIST: linked repeater systems).
- Merging shared backup files between net controllers.

## Screens (Phase 1)

- **Stations**: searchable directory (call sign prefix, suffix, or name), status, group memberships.
- **Station page**: details, standing notes, previous calls, memberships (add/remove, roles, spotter ID, active). Activity section reserved for the nets phase.
- **Groups**: list with type and member counts.
- **Group page**: details, members table, add member (from directory or new), CSV import with preview, members CSV export, access list.
- **Search** (Ctrl+K): jump to any station or group.
- **Settings**: backup, restore, current user.

## Migration from the single-file version

On first run, data saved by the earlier single-file version in the same browser (`netcontrol.v2`) is imported: each old net becomes a group with its members as memberships; every call sign seen becomes a station. Old session logs stay in the browser untouched and will be migrated in the nets phase. The single-file version is kept at `legacy/index.html`.
