-- Deliveries scheduling, phase 2: the committed assignment record. One row
-- per order that's been placed on a specific vehicle-day. order_total is
-- snapshotted at assignment time (not re-derived from order_items later) so
-- capacity math for a given slot+date stays stable even if order data changes
-- after the fact.
create table if not exists public.order_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  slot_id uuid not null references public.driver_schedule_slots(id) on delete cascade,
  scheduled_date date not null,
  order_total numeric not null default 0,
  assigned_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists order_deliveries_slot_date_idx
  on public.order_deliveries (slot_id, scheduled_date);
