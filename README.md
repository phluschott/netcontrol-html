# Net Controller

A single-file (`index.html`) logging console for amateur radio net control operators. Open it in a browser. Nothing to install, no account; data is kept in the browser (export CSV after each net).

## How it is meant to be used

1. **Set up a net once**: name, type, net control call sign, schedule, repeater, time format (local 12h / local 24h / UTC), preamble, standing announcements, closing, and optionally a roster.
2. **Each week**: Start Net, then step through the net flow bar:
   Preamble → Check-ins → Announcements → Round of Comments → Late Check-ins → Closing.
   Each step is time-stamped in the net log.
3. **End Net** gives a summary with QNI (check-ins), QTC (traffic), and QTR (minutes) for section net reports.

## Design notes from research

| Practice found in NCS manuals and scripts | How the app handles it |
|---|---|
| NCS logs the time, the calling station, and a brief note for transmissions; ARES manuals log in 24-hour time | Every check-in, recheck, note, and event is time-stamped. Each net picks local 12h, local 24h, or UTC. A live local + UTC clock is always on screen. Check-in time is editable when entries are made late. |
| Stations check in, then NCS goes around for comments | Check-in order is kept; a **NEXT** marker and a ✓ "had turn" toggle track the round. |
| "Rechecks": a station comes back with more, and is not counted twice | ↻ logs a recheck time, puts the station back in the queue, and leaves the QNI count alone. Typing an already-checked-in call does the same. |
| Short-time / mobile stations leave early | Check-in types include Short Time, Mobile, Relay, Portable, In & Out; "Sign out (QRT)" records the time a station left. |
| Calls for late check-ins after roll call | Check-ins after the Announcements step are flagged LATE automatically (editable). |
| Net control can be handed off mid-net | Click the NCS call in the header to hand off; it is logged with the time. |
| Partial calls: answer only what you copied | Typing any part of a call (including the suffix) narrows the roster list; nothing is guessed. |
| SKYWARN reports: who / what / when / where; time of the event vs. time reported; measured vs. estimated; hail compared to coins | Storm Report form (Skywarn and Emergency nets) records event, size/speed with a coin-size list, measured/estimated, observed time, location, remarks, and a "Relayed to NWS" time. |
| Section traffic reports use QNI, QTC, QTR, sessions | Shown on the summary, history list, CSV, and printout. |

Sources consulted (via search): ARRL NCS procedures and NTS MPG net operations; NYC ARES Net Control Manual; W8CUL, W5RRR, Tri-Cities RACES/ARES, and NW Harris County ARES net scripts; SVRC "Participating in a Net" (rechecks); 7290 Traffic Net check-in log; NWS Albuquerque and Columbia SKYWARN reporting guides; Arizona, Cleveland County, and Adams County SKYWARN scripts; Wisconsin and Ohio Section Traffic Manager reports; ICS-309 communications log.

No awards, badges, or streaks. The "3/5" next to a roster name only orders regulars to the top.
