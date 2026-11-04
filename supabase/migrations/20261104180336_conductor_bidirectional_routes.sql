-- Add explicit outbound/return pairing to routes and generate reverse routes
-- for all existing active routes without changing their IDs.
alter table public.conductor_routes
  add column if not exists pair_id text,
  add column if not exists direction text;

update public.conductor_routes
set pair_id = id,
    direction = coalesce(direction, 'outbound')
where pair_id is null or direction is null;

alter table public.conductor_routes
  alter column direction set default 'outbound',
  alter column direction set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conductor_routes_direction_check'
      and conrelid = 'public.conductor_routes'::regclass
  ) then
    alter table public.conductor_routes
      add constraint conductor_routes_direction_check
      check (direction in ('outbound', 'return'));
  end if;
end
$$;

create index if not exists conductor_routes_pair_idx
  on public.conductor_routes(pair_id, direction);

insert into public.conductor_routes
  (id, name, city, stops, fare_per_stop, pair_id, direction)
select
  'route_back_' || md5(r.id),
  r.name || ' (обратный)',
  r.city,
  (
    select coalesce(jsonb_agg(s.value order by s.ordinality desc), '[]'::jsonb)
    from jsonb_array_elements(r.stops) with ordinality as s(value, ordinality)
  ),
  r.fare_per_stop,
  r.id,
  'return'
from public.conductor_routes r
where r.archived_at is null
  and r.direction = 'outbound'
  and not exists (
    select 1 from public.conductor_routes back
    where back.pair_id = r.id and back.direction = 'return'
  );
