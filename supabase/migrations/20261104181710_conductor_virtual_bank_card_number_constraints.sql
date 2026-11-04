alter table public.conductor_cards
  alter column card_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='conductor_cards_number_format_check'
      and conrelid='public.conductor_cards'::regclass
  ) then
    alter table public.conductor_cards
      add constraint conductor_cards_number_format_check
      check (card_number ~ '^[0-9]{16}$');
  end if;
end
$$;