# Deploy notes (API)

Full deployment guide comes in the Deploy phase. Decisions so far:

- **MongoDB must be a replica set** (transactions). MongoDB Atlas is one; locally run `mongod --replSet rs0` and `rs.initiate()`.
- **Same-site subdomains**: app on `app.example.com`, API on `api.example.com`, so session cookies stay `SameSite=Strict`. Set `CORS_ORIGINS=https://app.example.com`.
- **Behind a reverse proxy** set `TRUST_PROXY=1` (number of proxies). Never `true`.
- **Rate limiting** uses the `mongo` store by default in production (`NODE_ENV=production`), so limits are shared by every API process. Use `REDIS_URL` for Redis instead; `RATE_LIMIT_STORE=memory` only for a single process.
- After each deploy that adds migrations: `npm run migrate` (idempotent).
- First deploy only: `npm run platform-admin -- you@example.com` (prints a one-time password).
- Archive job runs hourly inside the API (`RUN_JOBS=true`). With several API processes set `RUN_JOBS=false` on all but one, or run `npm run archive` from cron.
