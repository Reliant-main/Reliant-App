# Reliant Workspace

The Reliant Distribution Workspace, rebuilt on the Reliant database (Supabase), one section at a time.

- `index.html`: sign-in and the home screen
- `analytics.html`: Sales Analytics (owners and managers)
- `inventory.html`: Inventory, view only until switch day (costs and value shown to owners and managers only)
- `orders.html`: Orders & Receiving, view only until switch day (owners, managers and receiving staff; costs for owners and managers only)
- `purchasing.html`: Purchasing, the buy-list builder (owners and managers). Saved lists live in the database, since they don't come from the sheets.
- `shows.html`: Shows, view only: every show's results, customer events and open requests. The live show screen is `live.html` (rehearsal for now).
- `payouts.html`: Payouts (owners and managers): each show's net sales after fees, profit, and expected payout date (show date plus the platform's payout days), as a list, a calendar or both side by side; New, Used and Vintage separately or combined.
- `used.html`: Used Books (owners and managers): load results, check-ins due, used and vintage shows. The scan station comes later.
- `live.html`: the live show screen (Book Spotlight), same layout and buttons as the current Workspace: operator view, TV window (`live.html#display`), single-book and table rounds, bundles, R's, used-book shows with the speed round, requests, life events, flags and operator layouts. **Rehearsal only for now**: practice shows are kept in their own store (`live_docs`), never in the real shows and sales, so they don't reach Analytics, Inventory, the sheets or the nightly copy.
- `prep.html`: Show Prep, building a show's playlist ahead of time (works on a tablet; camera scanning where the browser supports it). The live show's "Load from Show Prep" reads these lists.
- `live-bridge.js`: connects the show screen to the database (shared show store with live updates, and the book list).
- `config.js`: the database address and its public key. What each person can see or change is enforced inside the database by their sign-in and role.

The site is published with GitHub Pages straight from this repository, so there is no build step. Until a section is switched over, the current Workspace (on Google Sheets) stays in use for it. A nightly copy keeps the database current with the sheets.
