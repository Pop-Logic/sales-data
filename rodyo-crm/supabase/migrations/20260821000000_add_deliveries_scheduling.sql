-- Deliveries scheduling, phase 1 (config + visibility, no auto-assignment yet).
--
-- Regions: repurpose the existing (empty, unused) public.regions table as
-- named delivery corridors, each holding a curated zip code list.
alter table public.regions
  add column if not exists zip_codes text[] not null default '{}';

-- Driver schedule: which vehicles run on which weekday, each pinned to a
-- region, with per-trip capacity caps. One row per (weekday, vehicle) — a
-- weekday can have multiple vehicles, each with its own fixed region, so no
-- geographic-splitting algorithm is needed (Option A from the scoping pass).
create table if not exists public.driver_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 1 and 7),
  vehicle_label text not null,
  region_id uuid references public.regions(id) on delete set null,
  max_stores integer,
  max_dollar_value numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists driver_schedule_slots_weekday_idx
  on public.driver_schedule_slots (weekday);

-- Cultivera already carries these on every order (buried in raw_payload) —
-- "Transfer Date" only populates once an order is actually invoiced/manifested
-- (the closest proxy Cultivera has to a real delivery confirmation), while
-- "Estimated delivery date" is present on every order from submission.
-- Promoting both to real columns lets the due-date queue and the passive
-- delivered-confirmation (no write-back to Cultivera) query them directly.
alter table public.orders
  add column if not exists transfer_date date,
  add column if not exists estimated_delivery_date date;
