alter table public.conductor_schedules
  add column if not exists return_body text not null default '';

update public.conductor_schedules s
set return_body = coalesce((
  select string_agg(regexp_replace(line, chr(9)||'.*$', ''), chr(10) order by ord desc)
  from unnest(string_to_array(replace(s.body, chr(13), ''), chr(10))) with ordinality as t(line, ord)
  where btrim(line) <> ''
), '')
where coalesce(s.return_body,'') = '' and coalesce(s.body,'') <> '';

grant select, insert, update, delete on public.conductor_schedules to anon, authenticated;
