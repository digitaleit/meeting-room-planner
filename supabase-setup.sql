create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint valid_booking_time check (start_time < end_time)
);

alter table public.bookings enable row level security;

drop policy if exists "Anyone can read bookings" on public.bookings;
drop policy if exists "Anyone can create bookings" on public.bookings;
drop policy if exists "Anyone can update bookings" on public.bookings;
drop policy if exists "Anyone can delete bookings" on public.bookings;

create policy "Anyone can read bookings"
on public.bookings
for select
using (true);

create policy "Anyone can create bookings"
on public.bookings
for insert
with check (true);

grant usage on schema public to anon;
grant select, insert on public.bookings to anon;

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
