-- store_locations.zip has apparently never been populated (0 of 528 stores
-- had a value) — every address string carries the zip at the end though
-- ("1956 1st Avenue South, Seattle, WA 98134"), so backfill from that.
-- Only fills currently-blank zips; never overwrites an existing value.
-- Deliveries phase 2 region-matching depends on this, but it's a standalone
-- data-quality fix independent of that feature.
update public.store_locations
set zip = substring(address from '(\d{5})(?:-\d{4})?\s*$')
where (zip is null or zip = '')
  and address ~ '\d{5}(?:-\d{4})?\s*$';
