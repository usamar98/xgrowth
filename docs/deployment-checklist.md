# Private deployment configuration

The local build creates a Worker bundle. Publishing a deployment and authorizing an X account are separate owner actions.

| Setting | Required value |
| --- | --- |
| Private ingress | Trusted Sites identity dispatcher. Disable direct public Worker routes, including public workers.dev access. |
| Owner | Set `OWNER_USER_ID` to the authorized identity from the dispatcher. |
| Database and images | Bind D1 as `DB` and private R2 as `BUCKET`. Apply every ordered migration in `drizzle/`. |
| App origin | Exact HTTPS workspace origin. Register its `/api/x/callback` with the X developer app. |
| Token encryption | 32 random bytes encoded as 64 hexadecimal characters. Back up the key securely. |
| Queue worker | Run `npm run worker` as a supervised process, using the same `APP_ORIGIN` and `SIGNALDESK_WORKER_SECRET` as the Worker. Permit service access to the internal tick endpoint through ingress. |
| Optional provider features | Set the optional environment entries only for locally available services and individually verified entitlements. |

Use the local development simulator exclusively on loopback. A personal production deployment requires actual private ingress authentication and the owner allowlist. The hosted Worker cannot reach an Ollama instance on the user's laptop through loopback.
