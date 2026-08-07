-- Tracks realized order->delivery lead time for manual "receive" entries
-- logged via the Order Received flow (as opposed to ad-hoc "Received
-- shipment" log entries with no associated order). ordered_at is the raw
-- fact (the date the order was placed, copied from packaging_items.on_order_eta
-- at receive time); lead_time_days is precomputed so future reporting
-- (e.g. average realized lead time per vendor) doesn't need date arithmetic
-- against a value that may since have changed on the item.
alter table public.packaging_ledger add column if not exists ordered_at date;
alter table public.packaging_ledger add column if not exists lead_time_days integer;
