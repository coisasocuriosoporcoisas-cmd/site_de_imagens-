create table if not exists public.login_lockouts (
  user_hash text primary key check (user_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer not null check (failed_attempts between 1 and 5),
  window_started_at timestamptz not null,
  locked_until timestamptz
);

alter table public.login_lockouts enable row level security;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;
alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check
  check (action in (
    'image.create', 'image.update', 'image.delete',
    'tag.update', 'tag.merge', 'tag.delete',
    'login.success', 'login.failure'
  ));

create or replace function public.is_login_locked(p_user_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked boolean;
begin
  if p_user_hash is null or p_user_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid account key';
  end if;
  select coalesce(bool_or(locked_until > now()), false)
  into locked
  from public.login_lockouts
  where user_hash = p_user_hash;
  return locked;
end;
$$;

create or replace function public.record_login_attempt(
  p_user_hash text,
  p_ip_hash text,
  p_succeeded boolean,
  p_actor_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_lock public.login_lockouts%rowtype;
  next_failures integer;
  locked boolean := false;
begin
  if p_user_hash is null or p_user_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid login attempt key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_hash, 0));

  if p_succeeded then
    delete from public.login_lockouts where user_hash = p_user_hash;
  else
    select * into current_lock
    from public.login_lockouts
    where user_hash = p_user_hash
    for update;

    if not found then
      insert into public.login_lockouts (user_hash, failed_attempts, window_started_at)
      values (p_user_hash, 1, now());
    elsif current_lock.locked_until > now() then
      locked := true;
    elsif current_lock.window_started_at <= now() - interval '15 minutes' then
      update public.login_lockouts
      set failed_attempts = 1, window_started_at = now(), locked_until = null
      where user_hash = p_user_hash;
    else
      next_failures := current_lock.failed_attempts + 1;
      locked := next_failures >= 5;
      update public.login_lockouts
      set failed_attempts = least(next_failures, 5),
          locked_until = case when locked then now() + interval '15 minutes' else null end
      where user_hash = p_user_hash;
    end if;
  end if;

  insert into public.admin_audit_logs (actor_id, action, details)
  values (
    p_actor_id,
    case when p_succeeded then 'login.success' else 'login.failure' end,
    jsonb_build_object('user_hash', p_user_hash, 'ip_hash', p_ip_hash, 'locked', locked)
  );
  return locked;
end;
$$;

revoke all on function public.is_login_locked(text) from public, anon, authenticated;
grant execute on function public.is_login_locked(text) to service_role;
revoke all on function public.record_login_attempt(text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.record_login_attempt(text, text, boolean, uuid) to service_role;

update storage.buckets
set file_size_limit = 52428800
where id = 'gallery';
