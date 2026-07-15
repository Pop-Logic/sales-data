-- Brand + type facets for packaging items (filterable/sortable in the UI).
-- brand: KS / MF / LL / ALL; item_type: JAR, LID, LABEL, BAG, PR TUBE, BOX, …
alter table public.packaging_items add column if not exists brand text;
alter table public.packaging_items add column if not exists item_type text;
