# Data Import Map

This file maps current V1 data sources into Supabase tables.

## Top Shelf Data Retailer List

Current source:

- Google Sheet gid `1421425539`
- Also used by `retailer_geocode.gs`

Target tables:

- `stores`
- `store_locations`

Important columns:

- `License` -> `stores.license`
- normalized license -> `stores.license_key`
- `Store Name` -> `stores.store_name`
- normalized store name -> `stores.store_key`
- `Address`, `City`, `State`, `Zip`, `County` -> `store_locations`
- `Latitude`, `Longitude`, `Google Place ID`, `Geocoded At`, `Geocode Status` -> `store_locations`
- market sales/category columns -> `store_locations`

## Monthly Revenue Sheet

Current source:

- Default Google Sheet gid `0`
- Parsed by V1 `parse_input`

Target table:

- `monthly_revenue`

Important transform:

- Convert each month column into one row per store/month.
- Strip total/subtotal/non-month columns before import.
- Aggregate duplicate licenses before insert/upsert.

## Cultivera Order Activity

Current source:

- Google Sheet tab `Cultivera Data`
- Populated by `cultivera_order_sync.gs`

Target tables:

- `orders`
- `order_items`

Important transform:

- Normalize license into `license_key`.
- Link to `stores.id` when possible.
- Preserve raw rows in `raw_payload` during early migration.
- Only `line_total > 0` rows count for active brand placement.

## Territory Rep Assignments

Current source:

- Google Sheet gid `1653796501`

Target tables:

- `reps`
- `regions`
- `stores.rep_id`
- `stores.region_id`

Important transform:

- Match by normalized license first.
- Fall back to normalized store name.

## Team Contact Log

Current source:

- Google Sheet tab `Contact Log`
- Local SQLite fallback in V1 is not durable and should not be a V2 source unless exported intentionally.

Target table:

- `contact_logs`

Important transform:

- Convert commitment into boolean.
- Convert date strings into `date`.
- Keep `revenue_label` as text because V1 sometimes stores risk labels, not pure dollars.

## Store Contacts

Current source:

- Google Sheet tab `Store Contacts`

Target table:

- `store_contacts`

Important transform:

- One current contact row per store.

## Sales Goals

Current source:

- Google Sheet tab `Sales Goals`

Target table:

- `sales_goals`

Important transform:

- Preserve EOM goals, weekly goals, brand-level goals, and notes.
