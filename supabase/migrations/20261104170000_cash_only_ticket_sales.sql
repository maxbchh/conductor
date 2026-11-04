-- Ticket sales require an open cash shift; an active driver shift is optional.
create or replace function public.conductor_validate_ticket_shifts()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare v_driver_status text; v_cash_status text;
begin
 if new.cash_shift_id is null then
  raise exception 'An open cash shift is required for ticket sales' using errcode='23514';
 end if;
 select status into v_cash_status from public.conductor_cash_shifts where id=new.cash_shift_id;
 if v_cash_status is distinct from 'open' then
  raise exception 'Cash shift is closed or does not exist' using errcode='23514';
 end if;
 if new.shift_id is not null then
  select status into v_driver_status from public.conductor_shifts where id=new.shift_id;
  if v_driver_status is distinct from 'open' then
   raise exception 'Driver shift is closed or does not exist' using errcode='23514';
  end if;
 end if;
 if new.route_id is not null and exists(select 1 from public.conductor_routes where id=new.route_id and archived_at is not null) then
  raise exception 'Archived routes cannot be used for ticket sales' using errcode='23514';
 end if;
 return new;
end $$;

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
 if v_shift_id is not null and not exists(select 1 from public.conductor_shifts where id=v_shift_id and status='open') then raise exception 'Driver shift is closed'; end if;
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
