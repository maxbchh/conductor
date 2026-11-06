-- News photos: public bucket for images attached to city news.
alter table public.conductor_news add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-images', 'news-images', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Public can view conductor news images" on storage.objects;
create policy "Public can view conductor news images" on storage.objects
for select to anon, authenticated
using (bucket_id = 'news-images');

drop policy if exists "Public can upload conductor news images" on storage.objects;
create policy "Public can upload conductor news images" on storage.objects
for insert to anon, authenticated
with check (bucket_id = 'news-images');
