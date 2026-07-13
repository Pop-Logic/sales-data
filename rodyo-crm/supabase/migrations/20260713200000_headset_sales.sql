-- Raw daily sell-through data from Headset
create table if not exists public.headset_sales (
  id bigserial primary key,
  day date not null,
  store_name text not null,
  account_rep text,
  product_name text not null,
  category text,
  unit_size text,
  brand text,
  total_sales numeric(10,2) not null default 0,
  total_units integer not null default 0,
  avg_item_price numeric(10,2),
  pct_days_in_stock numeric(5,2),
  avg_unit_cost numeric(10,2),
  store_id uuid references public.stores(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Prevent duplicate rows on re-import
create unique index if not exists headset_sales_dedup_idx
  on public.headset_sales (day, store_name, product_name);

-- Efficient per-store queries
create index if not exists headset_sales_store_day_idx
  on public.headset_sales (store_id, day desc)
  where store_id is not null;

create index if not exists headset_sales_day_idx
  on public.headset_sales (day desc);

-- Maps Headset store names → our store records
create table if not exists public.headset_store_map (
  id bigserial primary key,
  headset_name text not null unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Per-store aggregate used in DashboardSnapshot (last 30d + all-time last sale)
create or replace view public.headset_store_summary as
select
  store_id,
  max(day) as last_sale,
  coalesce(sum(total_units) filter (where day >= current_date - interval '30 days'), 0) as units_30d,
  coalesce(sum(total_sales) filter (where day >= current_date - interval '30 days'), 0) as sales_30d
from public.headset_sales
where store_id is not null
group by store_id;
