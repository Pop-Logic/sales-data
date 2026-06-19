# V2 Rules Inventory

The Streamlit app remains the current business-logic source of truth. V2 should preserve these meanings while moving calculations into Supabase SQL views, SQL functions, or typed server-side services.

## Core Brands

Tracked Balaclava brands:

- `K. Savage`
- `Mayfield`
- `Leisure Land`

Current V1 constant: `TERRITORY_BRANDS`.

## Store Universe

V1 combines:

- Monthly revenue sheet rows
- Cultivera order rows
- Top Shelf Data master retailer list
- Geocoded location data
- Territory rep assignment data

V2 rule:

- `stores` is the canonical retailer universe.
- `store_locations` stores geocoding and Top Shelf market metadata.
- Monthly revenue and order data should enrich stores, never define the whole retailer list by themselves.
- License matching is primary; normalized store-name matching is only fallback.

## Monthly Revenue Profile

V1 logic:

- Monthly sheet rows are keyed by license.
- Duplicate licenses are aggregated.
- Total/redundant columns are stripped.
- `Revenue Total` is the sum across month columns.
- `Latest Month Revenue` is the latest populated month, preferring the previous calendar month when available.
- `K. Savage Last Active` is the most recent monthly revenue month with revenue greater than zero.
- `K. Savage Monthly Run Rate` is the average of the last three active monthly revenue values.

V2 target:

- Store monthly revenue as one row per `store_id` + `revenue_month`.
- Build a view/materialized view for latest month, total revenue, last active month, last active revenue, active month count, and monthly run rate.

## Order Activity Profile

V1 logic:

- Cultivera rows are filtered to the three tracked brands.
- Only paid order lines count for active brand placement: `Line Total > 0` and valid submitted date.
- Brand activity window defaults to 120 days from the latest order date in the dataset.
- Per store, V1 derives:
  - Latest order date
  - Latest order number
  - Latest order amount
  - Total units
  - Brand revenue
  - Active-window revenue per tracked brand
  - K. Savage historical revenue
  - Latest K. Savage order date/amount

V2 target:

- Store orders in `orders` and `order_items`.
- Use a view or RPC with `active_days` parameter for active brand placement.
- Keep a default 120-day materialized view for dashboard speed.

## Carrying Brand Flags

V1 logic:

- `Carries {Brand}` is true when active-window revenue for that brand is greater than zero.
- `Carries K. Savage` is also true when latest monthly revenue is greater than zero.
- `K Savage Lapsed` is true when the store has K. Savage history but does not currently carry K. Savage.

V2 target:

- Store active brand revenue in `crm_store_rollup`.
- Store boolean carry flags as derived columns in views, not manually edited columns.

## Territory Recommendation

V1 decision order:

1. Missing coordinates -> `Needs location`
2. K Savage lapsed -> `K Savage Lapsed`
3. Carries Mayfield -> `Mayfield placed`
4. Nearby K. Savage and no nearby Mayfield -> `Pitch Mayfield`
5. Nearby K. Savage and does not carry K. Savage -> `K. Savage blocked`
6. Carries K. Savage -> `Maintain K. Savage`
7. Otherwise -> `Open lane`

V2 target:

- Use PostGIS for nearby-store counts.
- Keep recommendation order exactly as above.

## Priority Levels

V1 open lane priority:

- Only applies to recommendation `Open lane`.
- Uses `Market Sales Last Month`.
- Rank open-lane stores from low to high.
- Score thresholds:
  - `High`: `>= 0.75`
  - `Medium`: `>= 0.40`
  - `Low`: below `0.40`

V1 K Savage lapsed priority:

- Applies to recommendation `K Savage Lapsed`.
- Priority value uses:
  - `K. Savage Monthly Run Rate`
  - else `K. Savage Last Active Revenue`
  - else `K. Savage Historical Revenue`
- Same percentile thresholds as open lane.

V2 target:

- Implement priority scores in SQL using window functions.
- Preserve thresholds.

## Map Category

V1 decision order:

1. `Needs location`
2. `Carries K. Savage`
3. `K Savage Lapsed - {High|Medium|Low} Priority`
4. `Leisure Land Placed`
5. `Pitch Mayfield`
6. `Mayfield placed`
7. `Maintain K. Savage`
8. `Open Lane - {High|Medium|Low} Priority`
9. `Carries Mayfield`
10. `K. Savage blocked`
11. `No recent brand`

V2 target:

- Use this exact category order for color coding, filters, table labels, and map markers.

## All Other Retailers

V1 corrected behavior:

- `All Other Retailers` is the complement of all named designation filters.
- It should not mean all retailers in the state.
- It excludes `Needs location` in map selectors unless unmapped stores are being shown.

V2 target:

- Keep `All Other Retailers` as a derived filter, not a stored category.
- Include a separate `All Retailers` control that displays every retailer color-coded by designation.

## Contact Log Status

V1 matching:

- License match first.
- Store-name match fallback.
- Related normalized match keys are used for older/inconsistent contact rows.

V1 visible checks:

- Any saved contact log for the store -> green check in store row.
- Spec requires adding:
  - log ever
  - log this month
  - log this week

V2 target:

- Contact logs are first-class Supabase rows.
- `crm_store_rollup` should expose:
  - `has_contact_ever`
  - `has_contact_this_month`
  - `has_contact_this_week`

## Contact Log Fields

V1 contact log columns:

- License
- Store Name
- Month
- Revenue
- Date Contacted
- Commitment
- Cadence
- Committed Amount
- Notes
- Initials
- Person Contacted
- Contact Method
- Next Outreach
- Next Outreach Date
- Alert Recipient
- Alert CC
- Alert Sent Week
- Saved At

V2 target:

- Store these in `contact_logs`.
- Add typed fields where V1 stores strings: dates, booleans, timestamps.

## Store Contacts

V1 store contact fields:

- License Key
- License
- Store Name
- Contact Name
- Phone Number
- Updated At

V2 target:

- Store in `store_contacts`.
- Link to `stores.id`.

## Store Filters From Spec

V2 Stores page must support:

- Balaclava Sales dollar range
- Store Revenue dollar range
- Pareto
- Lapsed Priority
- Open Lane Priority
- Recent order date range
- Brand placement
- Region
- Proximity from Tacoma by default, or a user-entered origin, in miles

These filters should be query-backed and not require loading all rows into the browser.

## Route Priority

V1 base scores:

- `K Savage Lapsed - High Priority`: 100
- `Open Lane - High Priority`: 95
- `Pitch Mayfield`: 90
- `K. Savage blocked`: 86
- `K Savage Lapsed - Medium Priority`: 82
- `Open Lane - Medium Priority`: 78
- `Leisure Land Placed`: 62
- `Mayfield placed`: 58
- `Carries K. Savage`: 54
- `Maintain K. Savage`: 54
- `K Savage Lapsed - Low Priority`: 50
- `Open Lane - Low Priority`: 45
- `All Other Retailers`: 20
- `No recent brand`: 15

V1 then adds:

- `Priority Score * 15`
- A capped logarithmic bump for `Market Sales Last Month`
- Optional route-distance/detour penalties

V2 target:

- Keep route scoring server-side and return ranked candidates to the map/route UI.
