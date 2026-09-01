# Maviri

Maviri è il manager digitale per attività locali. Mavi è l'assistente interno che gestisce informazioni, clienti, disponibilità e prenotazioni.

## Base SaaS

La piattaforma mantiene compatibilità con il tenant storico `default` e separa dati Redis, contesto pubblico e lock di prenotazione per ogni attività.

## Variabili Vercel

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `MAVIRI_OWNER_SYNC_TOKEN`
- `MAVIRI_DEFAULT_TENANT` (facoltativa)
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`

I segreti devono restare nelle variabili d'ambiente Vercel.

## Verifica

Esegui `npm run verify`.
