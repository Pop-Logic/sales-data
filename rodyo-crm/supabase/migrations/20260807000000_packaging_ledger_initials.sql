-- Who logged a manual packaging_ledger entry (count/receive/adjust). The
-- entry's effective date is recorded via created_at itself (the ledger form
-- now passes an explicit created_at on save instead of always relying on the
-- insert-time default), so no separate date column is needed here.
alter table public.packaging_ledger add column if not exists initials text;
