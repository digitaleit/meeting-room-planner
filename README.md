# Planner Sala Riunioni

Webapp statica in HTML, CSS e JavaScript vanilla per prenotare una sala riunioni in coworking.

Funziona in due modi:

- **Modalita locale**, senza configurazione: salva le prenotazioni nel browser con `localStorage`.
- **Modalita condivisa**, con Supabase Free: salva le prenotazioni nella tabella `bookings`, aggiorna i dati in tempo reale o con refresh automatico e blocca le prenotazioni sovrapposte.

## Funzioni

- Prenotazione con nome, azienda, data, ora inizio, ora fine e note.
- Vista settimanale lunedi-venerdi.
- Stato sala: libera o occupata in questo momento.
- Lista delle prossime prenotazioni.
- Controllo sovrapposizioni lato browser.
- Controllo sovrapposizioni lato database con trigger Supabase.
- Nessun framework: solo file statici.

## File del progetto

- `index.html`: struttura della pagina.
- `style.css`: stile responsive.
- `script.js`: logica prenotazioni, validazione, Supabase e fallback locale.
- `supabase-setup.sql`: script pronto da copiare in Supabase.

## Configurare Supabase Free

1. Crea un account su [Supabase](https://supabase.com/).
2. Crea un nuovo progetto.
3. Apri **SQL Editor**.
4. Copia il contenuto di `supabase-setup.sql`, incollalo nell'editor ed eseguilo.

Lo script crea questa struttura:

```sql
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
```

5. Vai in **Project Settings** -> **API**.
6. Copia:
   - **Project URL**
   - **anon public key**
7. Apri `script.js` e compila queste righe:

```js
const SUPABASE_URL = "https://tuo-progetto.supabase.co";
const SUPABASE_ANON_KEY = "la-tua-anon-public-key";
```

8. In Supabase apri **Database** -> **Replication** e verifica che la tabella `bookings` sia abilitata per Realtime.

9. Fai commit e push della modifica a `script.js`.
10. Dopo il deploy automatico di GitHub Pages, la card in alto deve mostrare **Modalita condivisa**.

## Cosa devi incollarmi per attivarla

Mandami solo questi due valori Supabase:

- `Project URL`, simile a `https://xxxxxxxx.supabase.co`
- `anon public key`

Non mandarmi la `service_role key`: quella e privata e non va mai messa in una webapp pubblica.

## Pubblicare gratis su GitHub Pages

1. Crea un repository GitHub, per esempio `meeting-room-planner`.
2. Carica questi file nella root del repository:
   - `index.html`
   - `style.css`
   - `script.js`
   - `supabase-setup.sql`
   - `README.md`
3. Su GitHub apri **Settings** -> **Pages**.
4. In **Build and deployment** scegli:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/root**
5. Salva.
6. Dopo qualche minuto GitHub mostrerà l'URL pubblico della webapp.

## Sicurezza e limiti

Questa configurazione è pensata per una webapp pubblica e semplice. La chiave `anon public` può stare nel frontend, ma le policy RLS decidono cosa è permesso fare.

Le policy incluse permettono lettura e creazione pubblica delle prenotazioni, ma non aggiornamento o cancellazione. Per un coworking reale puoi irrigidire le regole, ad esempio richiedendo login, limitando la creazione o aggiungendo cancellazione solo per amministratori.

## Personalizzazione rapida

- Cambia colori e spaziature in `style.css`.
- Cambia gli orari predefiniti in `script.js`, nella funzione `init()`.
- Aggiungi campi alla tabella Supabase e al form se ti servono più dettagli.
