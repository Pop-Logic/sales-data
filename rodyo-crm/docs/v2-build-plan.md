# V2 Build Plan

## Milestone 1: Data Foundation

- Create Supabase schema and indexes.
- Import current retailer master list, geocodes, rep assignments, monthly revenue, Cultivera orders, contact logs, and goals.
- Build parity views that reproduce V1 counts and categories.

Done when:

- Total retailers matches the Top Shelf Data list.
- Mapped/unmapped counts match V1 after geocoding.
- Contact log row count matches current team log.
- Store category counts match V1 for default brand window and radius.

## Milestone 2: Store-First CRM

- Build the Stores route.
- Add filters from the spec.
- Add sortable/virtualized store list.
- Add store detail drawer with contact log form, buyer/contact info, contact history, order history, demographic info, and sample drops.

Done when:

- The filtered store list is fast enough to use with the full retailer universe.
- Contact logs save to Supabase and immediately update row checkmarks.

## Milestone 3: Territory Map

- Launch map from the current Stores filter set.
- Use PostGIS queries for bounding box, proximity, and radius filters.
- Add color-coded designations and clustered markers.

Done when:

- Map load uses only the filtered stores.
- `All Other Retailers` behaves as the complement of named designations.
- `All Retailers` shows every retailer color-coded by designation.

## Milestone 4: Orders And Goals

- Build brand summary and recent order activity.
- Add monthly and weekly goals.
- Add MoM comparison based on current filters.

Done when:

- Goal math and order summaries match V1.
- Sales leadership can review month progress without opening Streamlit.

## Milestone 5: Sync Jobs

- Move current Apps Script/Streamlit sync work into server-side jobs.
- Add sync run history and failure alerts.

Done when:

- Cultivera import, retailer/geocode import, contact log backup, and goals sync are visible in the Admin/Sync area.
