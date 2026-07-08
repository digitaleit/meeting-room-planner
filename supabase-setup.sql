create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  company text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint valid_booking_time check (start_time < end_time)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  company text not null,
  email text not null unique,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_requests (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  company text not null,
  email text not null,
  temporary_password_set boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.bookings add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.profiles enable row level security;
alter table public.user_requests enable row level security;
alter table public.bookings enable row level security;

create or replace function public.is_admin(user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = user_id
      and is_admin = true
  );
$$;

drop policy if exists "Anyone can read bookings" on public.bookings;
drop policy if exists "Anyone can create bookings" on public.bookings;
drop policy if exists "Anyone can update bookings" on public.bookings;
drop policy if exists "Anyone can delete bookings" on public.bookings;
drop policy if exists "Authenticated users can read bookings" on public.bookings;
drop policy if exists "Authenticated users can create bookings" on public.bookings;
drop policy if exists "Users can read their profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can manage user requests" on public.user_requests;

create policy "Authenticated users can read bookings"
on public.bookings
for select
to authenticated
using (true);

create policy "Authenticated users can create bookings"
on public.bookings
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can read their profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_admin(auth.uid()));

create policy "Admins can manage user requests"
on public.user_requests
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant select, insert on public.bookings to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.user_requests to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

insert into public.profiles (id, username, company, email, is_admin)
select id, 'digitaleit', 'digitaleit', 'stefano@stefanoserra.it', true
from auth.users
where email = 'stefano@stefanoserra.it'
on conflict (id) do update
set username = excluded.username,
    company = excluded.company,
    email = excluded.email,
    is_admin = true;

do $$
begin
  alter publication supabase_realtime add table public.bookings;
exception
  when duplicate_object then null;
end $$;

create or replace function public.prevent_overlapping_bookings()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.bookings b
    where b.date = new.date
      and new.start_time < b.end_time
      and new.end_time > b.start_time
      and (tg_op = 'INSERT' or b.id <> new.id)
  ) then
    raise exception 'overlapping booking';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_overlapping_bookings_trigger on public.bookings;

create trigger prevent_overlapping_bookings_trigger
before insert or update on public.bookings
for each row
execute function public.prevent_overlapping_bookings();
