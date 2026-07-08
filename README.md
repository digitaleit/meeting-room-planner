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
- Login con Supabase Auth.
- Profilo admin per `digitaleit`.
- Area admin per registrare richieste di nuovi utenti.
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
4. Vai in **Authentication** -> **Users**.
5. Crea il primo utente admin:
   - Email: `stefano@stefanoserra.it`
   - Password: quella scelta per l'accesso
   - Email confirm: attivo/confermato
6. Apri **SQL Editor**.
7. Copia il contenuto di `supabase-setup.sql`, incollalo nell'editor ed eseguilo.

Lo script crea le tabelle `bookings`, `profiles` e `user_requests`, abilita le policy RLS per utenti autenticati, collega il profilo admin `digitaleit` e mantiene il blocco delle prenotazioni sovrapposte.

8. Vai in **Project Settings** -> **API**.
9. Copia:
   - **Project URL**
   - **anon public key**
10. Apri `script.js` e compila queste righe:

```js
const SUPABASE_URL = "https://tuo-progetto.supabase.co";
const SUPABASE_ANON_KEY = "la-tua-anon-public-key";
```

11. In Supabase apri **Database** -> **Replication** e verifica che la tabella `bookings` sia abilitata per Realtime.

12. Fai commit e push della modifica a `script.js`.
13. Dopo il deploy automatico di GitHub Pages, la card in alto deve mostrare **Modalita condivisa con login**.

## Login admin iniziale

Il codice non contiene password e non deve contenerle mai. La password va salvata solo in Supabase Auth, dove viene gestita in modo sicuro.

Per creare il tuo accesso:

1. Vai su **Authentication** -> **Users**.
2. Crea l'utente `stefano@stefanoserra.it`.
3. Imposta la password desiderata.
4. Rilancia `supabase-setup.sql` in **SQL Editor**.
5. Accedi alla webapp con email e password.

Lo script collega quell'utente al profilo:

- User: `digitaleit`
- Azienda: `digitaleit`
- Email: `stefano@stefanoserra.it`
- Admin: si

## Nuovi utenti

L'area admin salva una richiesta utente con:

- user
- azienda
- email
- indicazione se esiste una password temporanea

Per creare davvero un account login hai due strade:

1. **Manuale, subito disponibile**
   - Vai in **Authentication** -> **Users**.
   - Crea l'utente con email e password temporanea.
   - Se non vuoi impostare una password, usa l'invio invito/reset password di Supabase.
   - Aggiungi o aggiorna il profilo in `profiles`.

Esempio profilo da inserire in **SQL Editor** dopo aver creato l'utente Auth:

```sql
insert into public.profiles (id, username, company, email, is_admin)
select id, 'nomeutente', 'Azienda ABC', 'utente@example.com', false
from auth.users
where email = 'utente@example.com'
on conflict (id) do update
set username = excluded.username,
    company = excluded.company,
    email = excluded.email,
    is_admin = excluded.is_admin;
```

2. **Automatica, piu professionale**
   - Crea una Supabase Edge Function con `service_role key`.
   - La funzione crea l'utente Auth, inserisce il profilo e invia la mail di impostazione password.
   - La `service_role key` deve stare solo nei secrets della funzione, mai in `script.js`.

## Email prenotazioni e calendario

GitHub Pages non puo inviare email direttamente in modo sicuro. Per inviare:

- conferma prenotazione all'utente;
- copia admin a `stefano@stefanoserra.it`;
- allegato `.ics` per il calendario personale;

serve una Supabase Edge Function collegata a un provider email, per esempio Resend, Brevo o SendGrid. Anche questa puo restare in fascia gratuita per un uso leggero.

La funzione dovrebbe partire quando viene creata una prenotazione, generare un file iCal e inviare le email. La webapp e gia pronta lato dati: ogni prenotazione ha `user_id`, nome, azienda, data, inizio, fine e note.

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

Questa configurazione usa Supabase Auth e Row Level Security. La chiave pubblica Supabase può stare nel frontend, ma la `service_role key` non deve mai essere inserita in `script.js`.

Le policy incluse permettono lettura e creazione delle prenotazioni solo agli utenti autenticati. La gestione automatica degli utenti e le email di calendario devono passare da una funzione server Supabase.

## Personalizzazione rapida

- Cambia colori e spaziature in `style.css`.
- Cambia gli orari predefiniti in `script.js`, nella funzione `init()`.
- Aggiungi campi alla tabella Supabase e al form se ti servono più dettagli.
