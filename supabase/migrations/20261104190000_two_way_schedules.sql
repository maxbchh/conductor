alter table public.conductor_schedules
  add column if not exists return_body text not null default '';

update public.conductor_schedules s
set return_body = coalesce((
  select string_agg(regexp_replace(line, E'\\t.*$', ''), E'\\n' order by ord desc)
  from regexp_split_to_table(s.body, E'\\r?\\n') with ordinality as t(line, ord)
  where btrim(line) <> ''
), '')
where coalesce(s.return_body,'') = '' and coalesce(s.body,'') <> '';

grant select, insert, update, delete on public.conductor_schedules to anon, authenticated;
