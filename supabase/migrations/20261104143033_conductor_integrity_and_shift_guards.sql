
-- Integrity and concurrency fixes (also recorded as migration 20261104143033).
create table if not exists public.conductor_cash_shifts (
 id text primary key, status text not null default 'open' check(status in ('open','closed')),
 started_at timestamptz not null default now(), ended_at timestamptz,
 opening_cash numeric(10,2) not null default 0, closing_cash numeric(10,2),
 note text not null default ''
);
create table if not exists public.conductor_news (
 id text primary key, title text not null, body text not null default '',
 category text not null default 'Город', published_at timestamptz not null default now(),
 archived_at timestamptz
);
alter table public.conductor_routes add column if not exists archived_at timestamptz;
alter table public.conductor_vehicles add column if not exists archived_at timestamptz;
alter table public.conductor_tickets add column if not exists archived_at timestamptz;
alter table public.conductor_tickets add column if not exists cash_shift_id text;
alter table public.conductor_news add column if not exists archived_at timestamptz;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='conductor_tickets_cash_shift_id_fkey' and conrelid='public.conductor_tickets'::regclass) then
  alter table public.conductor_tickets add constraint conductor_tickets_cash_shift_id_fkey
   foreign key(cash_shift_id) references public.conductor_cash_shifts(id) on delete set null;
 end if;
end $$;
create index if not exists conductor_tickets_cash_shift_idx on public.conductor_tickets(cash_shift_id);
create index if not exists conductor_tickets_active_issued_idx on public.conductor_tickets(issued_at desc) where archived_at is null;
create index if not exists conductor_routes_active_idx on public.conductor_routes(city,name) where archived_at is null;
create unique index if not exists conductor_one_open_driver_shift_idx on public.conductor_shifts(status) where status='open';
create unique index if not exists conductor_one_open_cash_shift_idx on public.conductor_cash_shifts(status) where status='open';
alter table public.conductor_cash_shifts enable row level security;
alter table public.conductor_news enable row level security;
drop policy if exists "Conductor public access cash shifts" on public.conductor_cash_shifts;
create policy "Conductor public access cash shifts" on public.conductor_cash_shifts for all to anon,authenticated using(true) with check(true);
drop policy if exists "Conductor public access news" on public.conductor_news;
create policy "Conductor public access news" on public.conductor_news for all to anon,authenticated using(true) with check(true);
grant select,insert,update,delete on public.conductor_cash_shifts,public.conductor_news to anon,authenticated;

create or replace function public.conductor_validate_ticket_shifts()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_driver_status text; v_cash_status text;
begin
 if new.shift_id is null or new.cash_shift_id is null then
  raise exception 'An open driver shift and cash shift are required for ticket sales' using errcode='23514';
 end if;
 select status into v_driver_status from public.conductor_shifts where id=new.shift_id;
 if v_driver_status is distinct from 'open' then
  raise exception 'Driver shift is closed or does not exist' using errcode='23514';
 end if;
 select status into v_cash_status from public.conductor_cash_shifts where id=new.cash_shift_id;
 if v_cash_status is distinct from 'open' then
  raise exception 'Cash shift is closed or does not exist' using errcode='23514';
 end if;
 if new.route_id is not null and exists(select 1 from public.conductor_routes where id=new.route_id and archived_at is not null) then
  raise exception 'Archived routes cannot be used for ticket sales' using errcode='23514';
 end if;
 return new;
end $$;
drop trigger if exists conductor_ticket_shift_guard on public.conductor_tickets;
create trigger conductor_ticket_shift_guard before insert on public.conductor_tickets
for each row execute function public.conductor_validate_ticket_shifts();

create or replace function public.conductor_close_shift(p_shift_id text)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_shift public.conductor_shifts%rowtype; v_vehicle public.conductor_vehicles%rowtype;
begin
 select * into v_shift from public.conductor_shifts where id=p_shift_id and status='open' for update;
 if not found then raise exception 'Driver shift is already closed or does not exist'; end if;
 if v_shift.vehicle_id is not null then
  select * into v_vehicle from public.conductor_vehicles where id=v_shift.vehicle_id for update;
  if found then
   update public.conductor_vehicles
    set status=coalesce(v_vehicle.previous_status,v_shift.previous_vehicle_status,'В эксплуатации'),
        previous_status=null,updated_at=now()
    where id=v_vehicle.id;
  end if;
 end if;
 update public.conductor_shifts set status='closed',ended_at=now()
  where id=p_shift_id returning * into v_shift;
 return to_jsonb(v_shift);
end $$;
grant execute on function public.conductor_close_shift(text) to anon,authenticated;

create or replace function public.conductor_charge_virtual_card(p_card_id text,p_ticket_rows jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_total numeric(12,2); v_balance numeric(12,2); v_item jsonb;
 v_ticket public.conductor_tickets%rowtype; v_tickets jsonb:='[]'::jsonb;
 v_shift_id text; v_cash_shift_id text;
begin
 if jsonb_typeof(p_ticket_rows)<>'array' or jsonb_array_length(p_ticket_rows)=0 then raise exception 'Ticket list is empty'; end if;
 select round(sum((item->>'amount')::numeric),2),min(item->>'shift_id'),min(item->>'cash_shift_id')
 into v_total,v_shift_id,v_cash_shift_id from jsonb_array_elements(p_ticket_rows) as items(item);
 if v_total is null or v_total<=0 then raise exception 'Invalid payment amount'; end if;
 if exists(select 1 from jsonb_array_elements(p_ticket_rows) as items(item)
   where item->>'shift_id' is distinct from v_shift_id or item->>'cash_shift_id' is distinct from v_cash_shift_id) then
  raise exception 'All tickets in one payment must belong to the same shifts';
 end if;
 if not exists(select 1 from public.conductor_shifts where id=v_shift_id and status='open') then raise exception 'Driver shift is closed'; end if;
 if not exists(select 1 from public.conductor_cash_shifts where id=v_cash_shift_id and status='open') then raise exception 'Cash shift is closed'; end if;
 update public.conductor_cards set balance=balance-v_total,updated_at=now()
  where id=p_card_id and balance>=v_total returning balance into v_balance;
 if not found then return jsonb_build_object('ok',false,'reason','insufficient_funds'); end if;
 for v_item in select value from jsonb_array_elements(p_ticket_rows) loop
  insert into public.conductor_tickets(shift_id,cash_shift_id,route_id,route_name,from_stop,to_stop,stop_count,
   fare_type,fare_multiplier,fare_per_stop,amount,payment_method,cash_received,change_due,game_time,card_id)
  values(v_item->>'shift_id',v_item->>'cash_shift_id',v_item->>'route_id',coalesce(v_item->>'route_name',''),
   v_item->>'from_stop',v_item->>'to_stop',(v_item->>'stop_count')::integer,v_item->>'fare_type',
   (v_item->>'fare_multiplier')::numeric,(v_item->>'fare_per_stop')::numeric,(v_item->>'amount')::numeric,
   'card',coalesce((v_item->>'cash_received')::numeric,0),coalesce((v_item->>'change_due')::numeric,0),
   v_item->>'game_time',p_card_id) returning * into v_ticket;
  v_tickets:=v_tickets||jsonb_build_array(to_jsonb(v_ticket));
 end loop;
 return jsonb_build_object('ok',true,'balance',v_balance,'tickets',v_tickets);
end $$;
grant execute on function public.conductor_charge_virtual_card(text,jsonb) to anon,authenticated;

do $$ declare v_table text; begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach v_table in array array['conductor_routes','conductor_vehicles','conductor_shifts','conductor_tickets','conductor_schedules','conductor_cards','conductor_cash_shifts','conductor_news'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
    execute format('alter publication supabase_realtime add table public.%I',v_table);
   end if;
  end loop;
 end if;
end $$;
