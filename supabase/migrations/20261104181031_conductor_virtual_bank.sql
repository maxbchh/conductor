-- Virtual Bank Conductor: fictional cards, balance operations and transaction history.
alter table public.conductor_cards
  add column if not exists bank_name text not null default 'Conductor Bank',
  add column if not exists card_number text,
  add column if not exists card_type text not null default 'Классическая',
  add column if not exists card_color text not null default 'blue';

update public.conductor_cards
set card_number = translate(substr(md5(id), 1, 16), 'abcdef', '012345')
where card_number is null or btrim(card_number) = '';

alter table public.conductor_cards
  alter column card_number set not null;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='conductor_cards_number_format_check' and conrelid='public.conductor_cards'::regclass) then
    alter table public.conductor_cards add constraint conductor_cards_number_format_check
      check (card_number ~ '^[0-9]{16}$');
  end if;
end
$$;
create unique index if not exists conductor_cards_card_number_uidx
  on public.conductor_cards(card_number);

create table if not exists public.conductor_card_transactions (
  id bigint generated always as identity primary key,
  card_id text not null references public.conductor_cards(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('top_up','withdrawal','empty','purchase')),
  amount numeric(12,2) not null check (amount > 0),
  balance_after numeric(12,2) not null check (balance_after >= 0),
  note text not null default '',
  ticket_numbers text,
  created_at timestamptz not null default now()
);
create index if not exists conductor_card_transactions_card_idx
  on public.conductor_card_transactions(card_id, created_at desc);

alter table public.conductor_card_transactions enable row level security;
drop policy if exists "Conductor public access card transactions" on public.conductor_card_transactions;
create policy "Conductor public access card transactions"
  on public.conductor_card_transactions for select to anon, authenticated using (true);
drop policy if exists "Conductor insert card transactions" on public.conductor_card_transactions;
create policy "Conductor insert card transactions"
  on public.conductor_card_transactions for insert to anon, authenticated with check (true);
grant select, insert on public.conductor_card_transactions to anon, authenticated;
grant usage, select on sequence public.conductor_card_transactions_id_seq to anon, authenticated;

create or replace function public.conductor_adjust_virtual_card(
  p_card_id text, p_action text, p_amount numeric default null, p_note text default ''
)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  v_card public.conductor_cards%rowtype;
  v_delta numeric(12,2);
  v_after numeric(12,2);
  v_type text;
  v_tx public.conductor_card_transactions%rowtype;
begin
  select * into v_card from public.conductor_cards where id=p_card_id for update;
  if not found then raise exception 'Virtual card not found'; end if;

  if p_action='top_up' then
    v_delta:=round(coalesce(p_amount,0),2);
    if v_delta<=0 then raise exception 'Top-up amount must be positive'; end if;
    v_after:=v_card.balance+v_delta; v_type:='top_up';
  elsif p_action='withdrawal' then
    v_delta:=round(coalesce(p_amount,0),2);
    if v_delta<=0 then raise exception 'Withdrawal amount must be positive'; end if;
    if v_card.balance<v_delta then raise exception 'Insufficient virtual balance'; end if;
    v_after:=v_card.balance-v_delta; v_type:='withdrawal';
  elsif p_action='empty' then
    v_delta:=v_card.balance;
    if v_delta<=0 then raise exception 'Virtual card balance is already zero'; end if;
    v_after:=0; v_type:='empty';
  else
    raise exception 'Unsupported virtual card operation';
  end if;

  update public.conductor_cards set balance=v_after,updated_at=now()
    where id=p_card_id returning balance into v_after;
  insert into public.conductor_card_transactions(card_id,transaction_type,amount,balance_after,note)
    values(p_card_id,v_type,v_delta,v_after,coalesce(nullif(btrim(p_note),''),''))
    returning * into v_tx;
  return jsonb_build_object('ok',true,'balance',v_after,'transaction',to_jsonb(v_tx));
end;
$$;
grant execute on function public.conductor_adjust_virtual_card(text,text,numeric,text) to anon,authenticated;

create or replace function public.conductor_charge_virtual_card(p_card_id text,p_ticket_rows jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
 v_total numeric(12,2); v_balance numeric(12,2); v_item jsonb;
 v_ticket public.conductor_tickets%rowtype; v_tickets jsonb:='[]'::jsonb;
 v_shift_id text; v_cash_shift_id text; v_ticket_numbers text;
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
 select string_agg(value->>'ticket_number',',') into v_ticket_numbers
 from jsonb_array_elements(v_tickets) as q(value);
 insert into public.conductor_card_transactions(card_id,transaction_type,amount,balance_after,note,ticket_numbers)
 values(p_card_id,'purchase',v_total,v_balance,'Оплата билета',v_ticket_numbers);
 return jsonb_build_object('ok',true,'balance',v_balance,'tickets',v_tickets);
end $$;
grant execute on function public.conductor_charge_virtual_card(text,jsonb) to anon,authenticated;
