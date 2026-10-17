create table if not exists public.emergency_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'manual'
    check (source in ('manual', 'camera', 'esp32')),
  status text not null default 'active'
    check (status in ('active', 'resolved')),
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  location_timezone text,
  location_status text not null default 'not_requested'
    check (location_status in (
      'not_requested', 'requesting', 'available', 'denied',
      'unavailable', 'timeout', 'unsupported', 'error'
    )),
  location_error text,
  updated_at timestamptz not null default now(),
  constraint emergency_events_latitude_range check (
    latitude is null or latitude between -90 and 90
  ),
  constraint emergency_events_longitude_range check (
    longitude is null or longitude between -180 and 180
  ),
  constraint emergency_events_coordinate_pair check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  ),
  constraint emergency_events_resolved_at check (
    (status = 'active' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

alter table public.emergency_events
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists accuracy_m double precision,
  add column if not exists location_timezone text,
  add column if not exists location_status text not null default 'not_requested',
  add column if not exists location_error text;

create index if not exists emergency_events_user_triggered_idx
  on public.emergency_events (user_id, triggered_at desc);

create unique index if not exists emergency_events_one_active_per_user_idx
  on public.emergency_events (user_id)
  where status = 'active';

create or replace function public.set_emergency_events_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists emergency_events_updated_at on public.emergency_events;
create trigger emergency_events_updated_at
  before update on public.emergency_events
  for each row execute function public.set_emergency_events_updated_at();

alter table public.emergency_events enable row level security;

revoke all on public.emergency_events from anon;
grant select, insert, update on public.emergency_events to authenticated;

drop policy if exists "Users can read their emergency events" on public.emergency_events;
create policy "Users can read their emergency events"
  on public.emergency_events for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their emergency events" on public.emergency_events;
create policy "Users can create their emergency events"
  on public.emergency_events for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their emergency events" on public.emergency_events;
create policy "Users can update their emergency events"
  on public.emergency_events for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'emergency_events'
  ) then
    alter publication supabase_realtime add table public.emergency_events;
  end if;
end
$$;

notify pgrst, 'reload schema';
