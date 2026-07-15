# Planner Sala Riunioni

Webapp statica in HTML, CSS e JavaScript vanilla per prenotare una sala riunioni in coworking.

Funziona in due modi:

- **Modalita locale**, senza configurazione: salva le prenotazioni nel browser con `localStorage`.
- **Modalita condivisa**, con Supabase Free: salva le prenotazioni nella tabella `bookings`, aggiorna i dati in tempo reale o con refresh automatico e blocca le prenotazioni sovrapposte.

## Funzioni

- Prenotazione con nome, azienda, data, ora inizio, ora fine e note.
- Vista settimanale lunedi-venerdi.
- Selezione slot dal calendario con tap/dito.
- Prenotazione intera giornata.
- Orario di fine aggiornato automaticamente se non successivo all'inizio.
- Modifica/cancellazione prenotazioni solo per proprietario o admin.
- Le prenotazioni passate non vengono mostrate.
- Stato sala: libera o occupata in questo momento.
- Lista delle prossime prenotazioni.
- Login con Supabase Auth.
- Profilo admin per `digitaleit`.
- Area admin per creare nuovi utenti.
- Email di conferma prenotazione con allegato calendario `.ics`.
- Copia admin di ogni prenotazione a `stefano@stefanoserra.it`.
- Controllo sovrapposizioni lato browser.
- Controllo sovrapposizioni lato database con trigger Supabase.
- Nessun framework: solo file statici.

## File del progetto

- `index.html`: struttura della pagina.
- `users.html`: pagina amministratore per la gestione utenti.
- `reset.html`: pagina per impostare una nuova password da link email.
- `style.css`: stile responsive.
- `script.js`: logica prenotazioni, validazione, Supabase e fallback locale.
- `users.js`: logica login admin, lista utenti, creazione utenti e reset password.
- `reset.js`: logica aggiornamento password.
- `supabase-setup.sql`: script pronto da copiare in Supabase.
- `supabase/functions/send-booking-email/index.ts`: funzione Supabase per inviare email e calendario.
- `supabase/functions/admin-create-user/index.ts`: funzione Supabase per creare utenti Auth e profili.
- `supabase/functions/manage-booking/index.ts`: funzione Supabase per modificare/cancellare prenotazioni solo come proprietario o admin.

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

La gestione utenti si trova nella pagina `users.html`, raggiungibile dal pulsante **Gestione utenti** visibile solo agli admin.

La pagina crea davvero un account Supabase Auth e il relativo profilo `profiles`.

Campi richiesti:

- user
- azienda
- email
- password temporanea opzionale

Se inserisci una password, l'utente potra accedere con quella. Se lasci la password vuota, la funzione crea una password temporanea casuale e invia all'utente la mail Supabase per impostare la propria password.

Nella stessa pagina puoi:

- vedere tutti gli utenti;
- impostare una nuova password temporanea;
- inviare un reset password via email.

Questa parte usa la funzione `admin-create-user`, che richiede il secret `SERVICE_ROLE_KEY`. La `service_role key` deve stare solo nei secrets Supabase, mai in `script.js`.

## Email prenotazioni e calendario

GitHub Pages non puo inviare email direttamente in modo sicuro. Per questo il progetto include una Supabase Edge Function in `supabase/functions/send-booking-email/index.ts`.

La funzione invia:

- conferma prenotazione all'utente;
- copia admin a `stefano@stefanoserra.it`;
- allegato `.ics` per il calendario personale.

### Configurare Brevo

1. Crea un account su [Brevo](https://www.brevo.com/).
2. Crea una API key.
3. Verifica un mittente, per esempio `stefano@stefanoserra.it`.
4. Usa quel mittente nei secrets Supabase.

### Deploy funzione Supabase

Installa la Supabase CLI, poi dalla cartella del progetto esegui:

```bash
supabase login
supabase link --project-ref zpiocrzswxjnfvyeinsi
supabase secrets set BREVO_API_KEY="la_tua_brevo_api_key"
supabase secrets set BREVO_SENDER_EMAIL="stefano@stefanoserra.it"
supabase secrets set BREVO_SENDER_NAME="Meeting Room Planner"
supabase secrets set ADMIN_EMAIL="stefano@stefanoserra.it"
supabase secrets set SERVICE_ROLE_KEY="la_tua_service_role_key"
supabase secrets set APP_BASE_URL="https://digitaleit.github.io/meeting-room-planner"
supabase functions deploy send-booking-email
supabase functions deploy admin-create-user
supabase functions deploy manage-booking
```

Dopo il deploy, quando un utente prenota, la webapp chiama la funzione `send-booking-email`. Se la funzione non e ancora configurata, la prenotazione viene comunque salvata, ma compare un avviso sull'email non inviata.

## Pubblicare gratis su GitHub Pages

1. Crea un repository GitHub, per esempio `meeting-room-planner`.
2. Carica questi file nella root del repository:
   - `index.html`
   - `users.html`
   - `reset.html`
   - `style.css`
   - `script.js`
   - `users.js`
   - `reset.js`
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

Le policy incluse permettono lettura e creazione delle prenotazioni solo agli utenti autenticati. La gestione automatica degli utenti, le email di calendario e la modifica/cancellazione delle prenotazioni passano da funzioni server Supabase.

## Personalizzazione rapida

- Cambia colori e spaziature in `style.css`.
- Cambia gli orari predefiniti in `script.js`, nella funzione `init()`.
- Aggiungi campi alla tabella Supabase e al form se ti servono più dettagli.
