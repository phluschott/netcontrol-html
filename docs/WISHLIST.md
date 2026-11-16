# Wishlist

Ideas to build later. Not scheduled; each will be designed before it is built.

## 1. Linked repeater systems

Support a repeater **system** made of several linked repeaters (towers), instead of a single repeater per net.

- **System**: name, owner/trustee, how the sites are linked (RF links, AllStar, IRLP, EchoLink, DMR, other), notes.
- **Repeaters / towers in the system**: name, location (city, county, grid), output frequency, offset, uplink and downlink tones, owner call sign, coverage notes, website.
- A net uses a system (or a single repeater), so the frequency list for the preamble comes from it.
- *To discuss:* record which repeater a station checked in through. This helps with signal reports and relays, and with knowing which coverage area a Skywarn spotter is in.
- *To discuss:* during an activation, mark a site as down or unlinked and note when, so net control knows which areas may not hear the net.

## 2. Member logins (standard users): on hold

*On hold (Nov 2026): this is a net control and admin tool, not a social network. Data is shared between net controllers with encrypted backup files instead.*

Members sign in with their own account and see their part of the app. Needs the hosted backend (accounts and sync); the access-control model already has a place for this.

- **Account linked to a station**: a member's login is tied to their call sign.
  - *To discuss:* how to confirm a person really holds that call sign. Options include a group admin approving the link, or checking against the FCC license database.
- **Profile page (self-service)**: the member edits their own call sign, name, on-air name, location, and contact details.
  - *To discuss:* which fields members may change themselves and which stay with group admins (for example roles and spotter ID).
  - *To discuss:* a call sign change keeps the old call as a previous call, as it does today.
- **My check-ins**: the member sees every check-in, across every group and net, read-only.
  - **Members can never delete a check-in**, including their own. Group admins can edit or delete check-ins.
- **Message boards**: one or more boards per group, possibly with forum-style topics and replies.
  - Members post to boards in groups they belong to.
  - **Messages can be deleted**: by their author, and by group admins for moderation.
  - The profile page lists the member's own messages.
  - *To discuss:* who can see a board (members only, or public), notifications by email, and whether net control can pin a board post (for example the week's announcements).
