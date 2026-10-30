# Reliant Workspace

The Reliant Distribution Workspace, rebuilt on the Reliant database (Supabase), one section at a time.

- `index.html`: sign-in and the home screen
- `analytics.html`: Sales Analytics (owners and managers)
- `inventory.html`: Inventory, view only until switch day (costs and value shown to owners and managers only)
- `orders.html`: Orders & Receiving, view only until switch day (owners, managers and receiving staff; costs for owners and managers only)
- `config.js`: the database address and its public key. What each person can see or change is enforced inside the database by their sign-in and role.

The site is published with GitHub Pages straight from this repository, so there is no build step. Until a section is switched over, the current Workspace (on Google Sheets) stays in use for it. A nightly copy keeps the database current with the sheets.
