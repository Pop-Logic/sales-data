-- Manual "mark delivered" — deliberately a separate column from
-- transfer_date. transfer_date is Cultivera-sourced and gets overwritten
-- (including back to null) on every hourly sync, so a manual mark stored
-- there would silently vanish. This column is never touched by sync.
alter table public.orders
  add column if not exists manual_delivered_at timestamptz;
