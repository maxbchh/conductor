-- Shared OMSI-style game clock for all Conductor clients.
create table if not exists public.conductor_game_clock (
  id text primary key check (id = 'main'),
  base_time timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rate numeric(5,2) not null default 1 check (rate > 0 and rate <= 32),
  is_paused boolean not null default false
);

alter table public.conductor_game_clock enable row level security;
drop policy if exists "Conductor public access game clock" on public.conductor_game_clock;
create policy "Conductor public access game clock"
  on public.conductor_game_clock for all to anon, authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.conductor_game_clock to anon, authenticated;

insert into public.conductor_game_clock(id, base_time, updated_at, rate, is_paused)
values ('main', now(), now(), 1, false)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'conductor_game_clock'
     ) then
    execute 'alter publication supabase_realtime add table public.conductor_game_clock';
  end if;
end
$$;
