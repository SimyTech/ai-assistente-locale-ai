# Maviri

Maviri è il manager digitale per attività locali. Mavi è l'assistente interno che gestisce informazioni, clienti, disponibilità e prenotazioni.

## Base SaaS

La piattaforma mantiene compatibilità con il tenant storico `default` e separa dati Redis, contesto pubblico e lock di prenotazione per ogni attività.

Le richieste pubbliche sono limitate per tenant e indirizzo IP tramite contatori Redis; gli IP non vengono conservati in chiaro nelle chiavi.

## Account titolare

Il login SaaS supporta account con username/email e password. L'account determina automaticamente il tenant e non può aprire un'attività diversa dalla propria.

Le password non vanno salvate in chiaro. Genera un hash con:

```bash
npm run hash-password -- "LaTuaPassword"
```

Configura quindi `MAVIRI_OWNER_ACCOUNTS` come JSON, per esempio:

```json
{
  "anna": {
    "tenantId": "salone-anna",
    "username": "anna",
    "email": "anna@example.it",
    "displayName": "Anna",
    "role": "owner",
    "passwordHash": "pbkdf2-sha256$210000$..."
  }
}
```

Il vecchio login tramite token resta disponibile solo per compatibilità durante la migrazione.

## Variabili Vercel

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `MAVIRI_OWNER_ACCOUNTS` (JSON degli account titolare con password hashata)
- `MAVIRI_OWNER_SYNC_TOKEN` (compatibilità tenant `default`)
- `MAVIRI_OWNER_TOKENS` (compatibilità: JSON con un token distinto per tenant)
- `MAVIRI_SESSION_SECRET` (necessaria per gli account e consigliata per tutte le sessioni proprietario)
- `MAVIRI_DEFAULT_TENANT` (facoltativa)
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `MAVIRI_WHATSAPP_TENANTS` (JSON `phone_number_id -> tenantId` per WhatsApp multi-attività)

I segreti devono restare nelle variabili d'ambiente Vercel.

## Verifica

Esegui `npm run verify`.
