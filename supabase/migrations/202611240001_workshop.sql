-- Auth users are provisioned by the owner; public signups must be disabled.
create table public.workshop_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  enabled boolean not null default true,
  daily_limit integer not null default 10 check (daily_limit between 1 and 100)
);
create table public.workshop_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.workshop_teams(id) on delete cascade
);
create table public.workshop_ai_usage (
  team_id uuid not null references public.workshop_teams(id) on delete cascade,
  day date not null,
  attempts integer not null default 0,
  last_request timestamptz not null default now(),
  primary key (team_id, day)
);
alter table public.workshop_teams enable row level security;
alter table public.workshop_members enable row level security;
alter table public.workshop_ai_usage enable row level security;
-- No public/browser CRUD grants. Only the Edge Function's service role accesses
-- membership and usage after validating the caller with Supabase Auth.
revoke all on public.workshop_teams, public.workshop_members, public.workshop_ai_usage from anon, authenticated;
grant all on public.workshop_teams, public.workshop_members, public.workshop_ai_usage to service_role;

create function public.reserve_patent_ai(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.workshop_teams%rowtype; u public.workshop_ai_usage%rowtype;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  -- Lock the team row: users on the same team share one atomic daily quota.
  select teams.* into t from public.workshop_teams teams
  join public.workshop_members members on members.team_id = teams.id
  where members.user_id = p_user_id for update of teams;
  if not found or not t.enabled then raise exception 'ACCOUNT_DISABLED'; end if;
  select * into u from public.workshop_ai_usage where team_id = t.id and day = today;
  if found then
    if u.attempts >= t.daily_limit then raise exception 'DAILY_LIMIT'; end if;
    if u.last_request > now() - interval '45 seconds' then raise exception 'COOLDOWN'; end if;
  end if;
  insert into public.workshop_ai_usage(team_id, day, attempts, last_request)
  values(t.id, today, 1, now()) on conflict(team_id, day)
  do update set attempts = public.workshop_ai_usage.attempts + 1, last_request = now()
  returning * into u;
  return jsonb_build_object('remaining', t.daily_limit - u.attempts, 'limit', t.daily_limit);
end;
$$;
revoke all on function public.reserve_patent_ai(uuid) from public, anon, authenticated;
grant execute on function public.reserve_patent_ai(uuid) to service_role;
