-- Packaging inventory: components (jars, lids, tubes, vape hardware, labels)
-- tracked via an append-only ledger. On-hand is always derived: latest physical
-- count + signed entries after it. Consumption is automatic — every new batch
-- barcode appearing in cultivera_inventory depletes its product family's BOM.

create table if not exists public.packaging_items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  vendor text,
  lead_time_days integer not null default 14,
  reorder_qty numeric,
  par_override numeric,
  on_order_qty numeric,
  on_order_eta date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Which product families consume this item. unit_size / strain null = any.
create table if not exists public.packaging_boms (
  id uuid primary key default gen_random_uuid(),
  packaging_item_id uuid not null references public.packaging_items(id) on delete cascade,
  sub_product_line text not null,
  unit_size text,
  strain text,
  qty_per_unit numeric not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists packaging_boms_subline_idx
  on public.packaging_boms (sub_product_line);

-- entry_type semantics:
--   count   → qty is the absolute counted amount (new baseline)
--   receive → qty is positive units received
--   consume → qty is positive units consumed (auto, keyed to batch barcode)
--   adjust  → qty is a signed correction
create table if not exists public.packaging_ledger (
  id uuid primary key default gen_random_uuid(),
  packaging_item_id uuid not null references public.packaging_items(id) on delete cascade,
  entry_type text not null check (entry_type in ('count', 'receive', 'consume', 'adjust')),
  qty numeric not null,
  source_barcode text,
  note text,
  created_at timestamptz not null default now()
);
-- Idempotent auto-consumption: one consume entry per (item, batch barcode).
-- Nulls are distinct, so manual entries never collide.
create unique index if not exists packaging_ledger_source_uniq
  on public.packaging_ledger (packaging_item_id, source_barcode);
create index if not exists packaging_ledger_item_idx
  on public.packaging_ledger (packaging_item_id, created_at desc);

-- Barcodes already evaluated for consumption. Seeded with everything currently
-- in stock so the feature starts from a clean baseline instead of retroactively
-- consuming packaging for batches made before tracking began.
create table if not exists public.packaging_seen_batches (
  barcode text primary key,
  first_seen timestamptz not null default now()
);
insert into public.packaging_seen_batches (barcode)
select barcode from public.cultivera_inventory
on conflict (barcode) do nothing;

-- On-hand + 60-day consumption per item, derived entirely from the ledger.
create or replace view public.packaging_on_hand as
select
  i.id as packaging_item_id,
  coalesce(lc.qty, 0) + coalesce(post.delta, 0) as on_hand,
  lc.created_at                                 as last_count_at,
  coalesce(v.consumed_60d, 0)                   as consumed_60d,
  v.first_consume_at
from public.packaging_items i
left join lateral (
  select qty, created_at
  from public.packaging_ledger
  where packaging_item_id = i.id and entry_type = 'count'
  order by created_at desc
  limit 1
) lc on true
left join lateral (
  select sum(case when entry_type = 'consume' then -qty else qty end) as delta
  from public.packaging_ledger
  where packaging_item_id = i.id
    and entry_type <> 'count'
    and created_at > coalesce(lc.created_at, '-infinity'::timestamptz)
) post on true
left join lateral (
  select
    sum(qty) filter (where created_at > now() - interval '60 days') as consumed_60d,
    min(created_at)                                                 as first_consume_at
  from public.packaging_ledger
  where packaging_item_id = i.id and entry_type = 'consume'
) v on true;
