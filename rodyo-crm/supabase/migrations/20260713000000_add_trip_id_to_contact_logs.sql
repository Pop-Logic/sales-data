alter table public.contact_logs add column if not exists trip_id uuid;

create index if not exists contact_logs_trip_id_idx on public.contact_logs (trip_id)
  where trip_id is not null;
