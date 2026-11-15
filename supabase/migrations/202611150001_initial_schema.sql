create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 50),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.images (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text check (description is null or char_length(description) <= 5000),
  storage_path text not null unique,
  thumbnail_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.image_tags (
  image_id uuid not null references public.images(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (image_id, tag_id)
);

create index images_created_at_idx on public.images (created_at desc);
create index images_updated_at_idx on public.images (updated_at desc);
create index images_title_search_idx on public.images using gin (to_tsvector('simple', title));
create index image_tags_tag_id_idx on public.image_tags (tag_id, image_id);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('image.create', 'image.update', 'image.delete', 'tag.update', 'tag.merge', 'tag.delete')),
  entity_id uuid,
  created_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index admin_audit_logs_created_at_idx on public.admin_audit_logs (created_at desc);

create table public.rate_limit_buckets (
  bucket_key text primary key,
  hits integer not null,
  window_started_at timestamptz not null
);

create or replace function public.is_gallery_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed boolean;
begin
  if p_limit < 1 or p_window_seconds < 1 or char_length(p_bucket_key) > 160 then
    raise exception 'invalid rate limit parameters';
  end if;
  if random() < 0.01 then
    delete from public.rate_limit_buckets
    where window_started_at < now() - interval '1 day';
  end if;

  insert into public.rate_limit_buckets (bucket_key, hits, window_started_at)
  values (p_bucket_key, 1, now())
  on conflict (bucket_key) do update
  set hits = case
      when public.rate_limit_buckets.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else public.rate_limit_buckets.hits + 1
    end,
    window_started_at = case
      when public.rate_limit_buckets.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else public.rate_limit_buckets.window_started_at
    end
  returning hits <= p_limit into allowed;

  return allowed;
end;
$$;

create or replace function public.get_similar_image_ids(p_image_id uuid, p_limit integer default 24)
returns table (image_id uuid, shared_tags bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select related.image_id, count(*) as shared_tags
  from public.image_tags as source
  join public.image_tags as related on related.tag_id = source.tag_id
  join public.images as related_image on related_image.id = related.image_id
  where source.image_id = p_image_id and related.image_id <> p_image_id
  group by related.image_id, related_image.created_at
  order by count(*) desc, related_image.created_at desc
  limit greatest(1, least(coalesce(p_limit, 24), 100));
$$;

create or replace function public.update_gallery_image(
  p_image_id uuid,
  p_title text,
  p_description text,
  p_tag_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_gallery_admin()) then
    raise exception 'not authorized';
  end if;

  update public.images
  set title = p_title, description = p_description, updated_at = now()
  where id = p_image_id;
  if not found then
    raise exception 'image not found';
  end if;

  delete from public.image_tags where image_id = p_image_id;
  insert into public.image_tags (image_id, tag_id)
  select p_image_id, distinct_tags.tag_id
  from (select distinct unnest(coalesce(p_tag_ids, '{}'::uuid[])) as tag_id) as distinct_tags;

  insert into public.admin_audit_logs (actor_id, action, entity_id)
  values ((select auth.uid()), 'image.update', p_image_id);
end;
$$;

revoke all on function public.is_gallery_admin() from public;
grant execute on function public.is_gallery_admin() to anon, authenticated;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
revoke all on function public.get_similar_image_ids(uuid, integer) from public;
grant execute on function public.get_similar_image_ids(uuid, integer) to anon, authenticated;
revoke all on function public.update_gallery_image(uuid, text, text, uuid[]) from public;
grant execute on function public.update_gallery_image(uuid, text, text, uuid[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.tags enable row level security;
alter table public.images enable row level security;
alter table public.image_tags enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.rate_limit_buckets enable row level security;

create policy "Profiles are private" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "Users manage own future profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Admins can read own membership" on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Public can read tags" on public.tags for select to anon, authenticated using (true);
create policy "Admins manage tags" on public.tags for all to authenticated
  using ((select public.is_gallery_admin())) with check ((select public.is_gallery_admin()));

create policy "Public can read gallery images" on public.images for select to anon, authenticated using (true);
create policy "Admins manage images" on public.images for all to authenticated
  using ((select public.is_gallery_admin())) with check ((select public.is_gallery_admin()));
revoke select on public.images from anon, authenticated;
grant select (id, title, description, storage_path, thumbnail_path, width, height, created_at, updated_at)
  on public.images to anon, authenticated;

create policy "Public can read image tags" on public.image_tags for select to anon, authenticated using (true);
create policy "Admins manage image tags" on public.image_tags for all to authenticated
  using ((select public.is_gallery_admin())) with check ((select public.is_gallery_admin()));

create policy "Admins read audit log" on public.admin_audit_logs for select to authenticated
  using ((select public.is_gallery_admin()));
create policy "Admins create audit log" on public.admin_audit_logs for insert to authenticated
  with check ((select public.is_gallery_admin()) and actor_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 52428800, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = array['image/webp'];

create policy "Public reads gallery objects" on storage.objects for select to anon, authenticated
  using (bucket_id = 'gallery');
create policy "Admins upload gallery objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (select public.is_gallery_admin()));
create policy "Admins update gallery objects" on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and (select public.is_gallery_admin()))
  with check (bucket_id = 'gallery' and (select public.is_gallery_admin()));
create policy "Admins delete gallery objects" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (select public.is_gallery_admin()));

comment on table public.profiles is 'Reserved for future public user profiles; regular user registration is not enabled.';
comment on table public.admin_audit_logs is 'Administrative actions; writes are limited to authenticated gallery admins.';
