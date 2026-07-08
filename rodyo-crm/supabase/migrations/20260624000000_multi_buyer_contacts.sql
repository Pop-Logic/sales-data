-- Allow multiple contacts per store
alter table public.store_contacts drop constraint if exists store_contacts_store_id_key;

-- Add role/title and stable creation timestamp
alter table public.store_contacts add column if not exists role text;
alter table public.store_contacts add column if not exists created_at timestamptz not null default now();

-- Allow authenticated users to delete contacts
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'store_contacts'
      and policyname = 'authenticated delete store contacts'
  ) then
    execute $p$
      create policy "authenticated delete store contacts"
        on public.store_contacts
        for delete
        to authenticated
        using (true)
    $p$;
  end if;
end $$;
