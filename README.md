# Reliant Workspace

The Reliant Distribution Workspace, rebuilt on the Reliant database (Supabase), one section at a time.

- `index.html`: sign-in and the home screen
- `analytics.html`: Sales Analytics (owners and managers)
- `inventory.html`: Inventory, view only until switch day (costs and value shown to owners and managers only). Shows Available now and Held for shows: copies pulled for a show in Show Prep or sitting in a running show.
- `orders.html`: Orders & Receiving, view only until switch day (owners, managers and receiving staff; costs for owners and managers only)
- `purchasing.html`: Purchasing, the buy-list builder (owners and managers). Saved lists live in the database, since they don't come from the sheets.
- `shows.html`: Shows, view only: every show's results, customer events and open requests. The live show screen is `live.html` (rehearsal for now).
- `payouts.html`: Payouts (owners and managers): each show's net sales after fees, profit, and expected payout date (show date plus the platform's payout days), as a list, a calendar or both side by side; New, Used and Vintage separately or combined. A Consignors panel shows what each consignor (8th Day 50%, Dr. Baker 60% of the after-fees amount) is owed per month, with a Record payment button.
- `used.html`: Used Books (owners and managers): load results, check-ins due, used and vintage shows. The scan station comes later.
- `live.html`: the live show screen (Book Spotlight), same layout and buttons as the current Workspace: operator view, TV window (`live.html#display`), single-book and table rounds, sets (Load next set, a Rejects set and a Celeb shots set), two-book lots, damaged copies (replaced or not), bundles, R's, used-book shows with the speed round, requests, life events, flags and operator layouts. **Rehearsal only for now**: practice shows are kept in their own store (`live_docs`), never in the real shows and sales, so they don't reach Analytics, Inventory, the sheets or the nightly copy.
- `station.html`: the Ticket System: platform orders arrive live (Whatnot first) with per-show buyer numbers, chits print on the Star TSP700II (2 x 1 in, at the sale, after the scan with the title, or both), and each scanned or typed book attaches to the oldest sale without a book (+ Same sale for lots). Practice sales test it without Whatnot; they live in `live_shows`/`live_sales` marked practice and never reach real sales.
- `prep.html`: Show Prep, building a show's playlist ahead of time (works on a tablet; camera scanning where the browser supports it). Add set starts the next table set; + 2nd book makes a two-book lot. The live show's "Load from Show Prep" reads these lists.
- `executive.html`: Executive (owners only, enforced in the database): a shared calendar with a notes panel for the selected day, event types with colors (bills, payouts, platform promos, etc.), days colored for big money in or out, alerts (reminders, bills not marked paid, promos starting, large expected payouts), and a quick review of recent shows (sales, profit, average sale and profit per book, by platform; 7 days by default, longer or picked dates). Not on the home screen yet: open it at its own address while testing.
- `settings.html`: Settings (owners and managers). Add or remove people by email, set their name and access level, and approve their sign-up. Each person sets their own password.
- `live-bridge.js`: connects the show screen to the database (shared show store with live updates, and the book list).
- `config.js`: the database address and its public key. What each person can see or change is enforced inside the database by their sign-in and role.

The site is published with GitHub Pages straight from this repository, so there is no build step. Until a section is switched over, the current Workspace (on Google Sheets) stays in use for it. A nightly copy keeps the database current with the sheets.
