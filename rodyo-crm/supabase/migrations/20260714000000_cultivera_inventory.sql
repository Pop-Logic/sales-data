-- Batch-level inventory rows from Cultivera "Export Batches Currently in Stock"
create table if not exists public.cultivera_inventory (
  barcode text primary key,
  product text not null,
  product_line text,
  sub_product_line text,
  category text,
  sub_category text,
  room text,
  batch_date timestamptz,
  qa_thca numeric,
  qa_thc numeric,
  qa_cbd numeric,
  qa_total numeric,
  availability text,
  units_for_sale numeric not null default 0,
  units_on_hold numeric not null default 0,
  units_allocated numeric not null default 0,
  units_in_stock numeric not null default 0,
  synced_at timestamptz not null default now()
);

create index if not exists cultivera_inventory_product_idx
  on public.cultivera_inventory (sub_product_line, product);
create index if not exists cultivera_inventory_synced_idx
  on public.cultivera_inventory (synced_at desc);

-- Optional per-SKU reorder thresholds (editable in the UI)
create table if not exists public.inventory_reorder_thresholds (
  sub_product_line text primary key,
  threshold_days integer not null default 14,
  notes text,
  updated_at timestamptz not null default now()
);

-- Per-product aggregate — used in the Inventory view
create or replace view public.cultivera_inventory_summary as
select
  product,
  sub_product_line,
  category,
  sub_category,
  max(batch_date)                      as latest_batch_date,
  count(*)                             as batch_count,
  sum(units_for_sale)                  as total_for_sale,
  sum(units_on_hold)                   as total_on_hold,
  sum(units_allocated)                 as total_allocated,
  sum(units_in_stock)                  as total_in_stock,
  round(avg(qa_thca)::numeric, 2)      as avg_thca,
  round(avg(qa_total)::numeric, 2)     as avg_total_thc,
  max(synced_at)                       as synced_at
from public.cultivera_inventory
group by product, sub_product_line, category, sub_category;
