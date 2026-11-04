
-- Follow-up consistency and performance indexes.
create index if not exists conductor_shifts_route_idx on public.conductor_shifts(route_id);
create index if not exists conductor_shifts_vehicle_idx on public.conductor_shifts(vehicle_id);
create index if not exists conductor_tickets_route_idx on public.conductor_tickets(route_id);

create or replace function public.conductor_validate_ticket_shifts()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_driver_status text; v_cash_status text;
begin
 if new.shift_id is null or new.cash_shift_id is null then
  raise exception 'An open driver shift and cash shift are required for ticket sales' using errcode='23514';
 end if;
 select status into v_driver_status from public.conductor_shifts where id=new.shift_id for share;
 if v_driver_status is distinct from 'open' then
  raise exception 'Driver shift is closed or does not exist' using errcode='23514';
 end if;
 select status into v_cash_status from public.conductor_cash_shifts where id=new.cash_shift_id for share;
 if v_cash_status is distinct from 'open' then
  raise exception 'Cash shift is closed or does not exist' using errcode='23514';
 end if;
 if new.route_id is not null and exists(select 1 from public.conductor_routes where id=new.route_id and archived_at is not null) then
  raise exception 'Archived routes cannot be used for ticket sales' using errcode='23514';
 end if;
 return new;
end $$;
