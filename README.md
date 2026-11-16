# Net Control

A browser app for amateur radio net control operators. It works offline once loaded, stores data in the browser, and is built for one operator today with group roles ready for more users later.

**Status:** Phase 1 is done: stations, groups, memberships, CSV import, station lookup, backup. Nets are next and will be designed together first. See [docs/DESIGN.md](docs/DESIGN.md).

## What it does now

- **Stations**: one record per call sign, shared by every group. Name, on-air name, location, status (Active / Inactive / Silent Key), standing notes, previous call signs. Changing a call sign keeps the old one so history follows the station.
- **Groups**: Skywarn teams, clubs, ARES units, traffic nets. A station can belong to any number of groups, with roles (member, spotter, net control, officer), spotter ID, joined date, and active/inactive per group.
- **CSV import into a group**: rows are matched to existing stations by call sign; existing stations are added to the group, never duplicated. A preview shows new stations, stations added, already-members, skipped rows, and every field where the file differs from what is on file, with a keep/use-file choice per field.
- **Station page**: everything about one station, every group it belongs to, and a history of changes. Check-ins, notes, and storm reports will appear here once nets exist.
- **Search**: Ctrl+K from anywhere; matches call sign prefix or suffix, previous calls, name, or city.
- **Backup / restore**: one JSON file holds everything. A "Backup due" reminder appears after 7 days.
- **Access control**: every change checks the user's role in the group (owner, admin, operator, viewer) and is recorded in a change log.

The earlier single-page version is kept at `public/legacy/index.html`; its members are imported automatically the first time the new app opens in the same browser.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (data layer, import, permissions, backup, migration)
npm run build      # production build in dist/
npm run preview    # serve the production build (offline mode works here)
```

Stack: Vite, React, TypeScript, Dexie (IndexedDB), vite-plugin-pwa.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. Enable it once in the repository: **Settings → Pages → Source: GitHub Actions**.
