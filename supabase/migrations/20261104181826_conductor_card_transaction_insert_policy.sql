drop policy if exists "Conductor insert card transactions" on public.conductor_card_transactions;
create policy "Conductor insert card transactions"
  on public.conductor_card_transactions
  for insert to anon, authenticated
  with check (true);
grant select, insert on public.conductor_card_transactions to anon, authenticated;
grant usage, select on sequence public.conductor_card_transactions_id_seq to anon, authenticated;