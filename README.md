# Maviri

Maviri è un manager digitale SaaS per attività. Mavi è l'assistente interno che usa i dati reali dell'attività per clienti, agenda, disponibilità, prenotazioni e analisi operative.

La piattaforma non è legata a un solo settore: ogni tenant possiede un profilo attività con modalità di lavoro, capacità e terminologia configurabili.

## Flusso SaaS

Una nuova attività può partire senza configurazione tecnica manuale:

1. `/register` crea account e tenant separato.
2. La password viene salvata solo come hash PBKDF2-SHA256.
3. Viene aperta una sessione HttpOnly `SameSite=Strict`.
4. `/setup` configura settore, modalità di lavoro e terminologia.
5. Il profilo alimenta automaticamente anche il dataset operativo usato da Mavi.
6. `/app` verifica sessione e profilo prima di caricare la dashboard.
7. Il browser elimina la cache gestionale precedente quando cambia tenant, impedendo riuso accidentale dei dati di un'altra attività.

Gli account storici definiti tramite variabile d'ambiente restano supportati durante la migrazione; una nuova registrazione non può riutilizzare un login già configurato.

## Profilo attività universale

Modalità di lavoro supportate:

- principalmente su appuntamento;
- principalmente senza appuntamento;
- modalità mista;
- senza agenda.

Preset iniziali disponibili per benessere/bellezza, studi professionali, salute, fitness/sport, automotive, retail, hospitality e attività generica.

Le etichette sono configurabili, per esempio:

- Cliente / Paziente / Socio / Ospite;
- Servizio / Prestazione / Intervento / Lezione;
- Appuntamento / Prenotazione / Visita.

La dashboard usa queste impostazioni per ordinare, rinominare o nascondere i moduli non pertinenti.

## Mavi — Business Engine

Mavi lavora senza inventare disponibilità o dati commerciali. Calendario e Business Engine sono la fonte per gli slot prenotabili.

Oltre a servizi, prezzi, promozioni, orari e prenotazioni, il titolare può chiedere analisi come:

- clienti abituali;
- clienti che non tornano da almeno 60 giorni;
- clienti con maggiore valore storico;
- numero clienti;
- clienti senza visite registrate;
- appuntamenti/visite di oggi o domani;
- riepilogo operativo dell'attività.

Le analisi escludono appuntamenti cancellati e non trattano prenotazioni future come visite già effettuate.

## Prenotazioni

Il flusso applica:

- verifica disponibilità reale;
- durata del servizio;
- orari e pause;
- controllo sovrapposizioni;
- conferma esplicita;
- secondo controllo server-side;
- lock Redis anti-doppia prenotazione;
- creazione/collegamento cliente;
- owner-pull verso il calendario Maviri.

## Multi-tenant

I dati Redis, il contesto pubblico, i lock, i rate limit, le sessioni WhatsApp e i profili attività sono separati per tenant.

Il contenitore autenticato forza `x-maviri-tenant` su tutte le API interne e passa a Mavi anche il profilo dell'attività. La cache locale storica viene invalidata quando lo stesso browser passa a un tenant diverso.

## Account e sicurezza

Gli account self-service sono salvati in Redis. Le chiavi di lookup del login usano un digest SHA-256 e non espongono l'email in chiaro nel nome della chiave.

Le password usano PBKDF2-SHA256 con salt casuale e almeno 210.000 iterazioni. Il login è limitato a 8 tentativi in 15 minuti; la registrazione a 4 tentativi l'ora per indirizzo IP hashato.

Per gli account storici è ancora possibile generare manualmente un hash con:

```bash
npm run hash-password -- "LaTuaPassword"
```

Il vecchio token proprietario resta disponibile soltanto come compatibilità di migrazione.

## WhatsApp

Il bridge WhatsApp Cloud API supporta:

- routing numero Meta → tenant;
- sessione conversazionale in Redis;
- raccolta servizio/data/ora/nome;
- verifica disponibilità;
- conferma esplicita;
- prenotazione persistente;
- deduplicazione webhook;
- firma Meta HMAC-SHA256.

`/api/whatsapp` passa da un endpoint raw-body con body parser disabilitato. La firma `x-hub-signature-256` viene verificata sui byte originali prima del parsing JSON.

La configurazione effettiva del numero WhatsApp e dell'account Meta resta un passaggio esterno alla codebase.

## Route principali

- `/` — login
- `/register` — registrazione nuova attività
- `/setup` — onboarding/configurazione attività
- `/app` — dashboard autenticata
- `/api/auth` — login/sessione/logout
- `/api/register` — creazione account e tenant
- `/api/activity-profile` — profilo universale attività
- `/api/chat` — Mavi + Business Engine
- `/api/whatsapp` — webhook WhatsApp
- `/api/health` — stato readiness SaaS

## Variabili Vercel

Core SaaS:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `MAVIRI_SESSION_SECRET`

Compatibilità/migrazione:

- `MAVIRI_OWNER_ACCOUNTS` — JSON account storici con password hashata
- `MAVIRI_OWNER_SYNC_TOKEN` — token storico tenant `default`
- `MAVIRI_OWNER_TOKENS` — JSON token storici per tenant
- `MAVIRI_DEFAULT_TENANT` — facoltativa

WhatsApp:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET` — raccomandata per verifica firma webhook
- `MAVIRI_WHATSAPP_TENANTS` — JSON `phone_number_id -> tenantId`

Tutti i segreti devono restare nelle variabili d'ambiente Vercel.

## Health e verifica

`GET /api/health` considera il core SaaS pronto quando Redis e `MAVIRI_SESSION_SECRET` sono configurati. Lo stato WhatsApp è esposto separatamente perché è una capability opzionale.

Per verificare localmente:

```bash
npm run verify
```

La pipeline GitHub Actions esegue controlli sintattici e la suite automatica a ogni push su `main`.

## Dipendenze esterne ancora necessarie per il lancio commerciale

La codebase core non può completare autonomamente configurazioni che richiedono account o contratti esterni. Prima del lancio pubblico restano da collegare, se desiderati:

- numero e credenziali Meta WhatsApp Cloud API;
- un provider di pagamento per abbonamenti;
- un provider email per verifica indirizzo e recupero password;
- pagine legali/privacy e condizioni commerciali definitive.

Questi elementi sono integrazioni di lancio, non dipendenze del motore gestionale e di prenotazione.
