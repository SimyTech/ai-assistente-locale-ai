# Mavi operational fast path

This branch routes deterministic operational API actions directly from `api/chat-entry.js` to the verified business engine in `api/chat.js`, bypassing the conversational proxy.

Direct actions: availability, book, update, cancel, confirm-attendance, client, context, public-context, owner-pull.

`chat` and `owner-sync` keep the existing proxy/normalization path. Authentication, rate limiting, Redis locking, availability checks and booking confirmation remain enforced by `api/chat.js`.
