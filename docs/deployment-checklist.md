# Private deployment configuration

## Vercel

1. Select the repository root, the **Next.js** framework preset and Node.js 22.x. The repository configuration runs `npm run build:vercel` and reads `.next`.
2. Set `APP_ORIGIN` to the exact HTTPS origin where you will sign in, such as `https://your-project.vercel.app`. Set `OWNER_USER_ID` to a stable private workspace identifier. Generate a new owner login key with `node -p "require('node:crypto').randomBytes(32).toString('hex')"` on your own machine. Save it in a password manager and set it as `SIGNALDESK_OWNER_KEY` in Vercel. Rotating this key also revokes active login sessions.
3. Configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for a persistent libSQL database in the Vercel environment. From a trusted checkout, set the same variables in your shell or ignored `.env` and run `npm run db:migrate:vercel` against that database. The build can run without credentials. Schema migrations are an explicit setup step. Local D1 data stays on the machine where it was created.
4. Optional features have separate setup. Link a **private** Vercel Blob store for draft images. For X, set `X_CLIENT_ID`, `X_CLIENT_SECRET`, and `X_TOKEN_ENCRYPTION_KEY` and register `APP_ORIGIN/api/x/callback` using the actual origin. For scheduled work, run `npm run worker` on an always-on process with the deployment's `APP_ORIGIN` and matching `SIGNALDESK_WORKER_SECRET`. Ollama on your laptop is available only to the local app.
5. In Vercel, create a deployment from the updated `main` commit. Open the configured HTTPS origin, choose **Sign in to connect**, enter the owner key and save a draft to check the connection to your database. Use a separate database and credentials for a preview environment if needed.

## Cloudflare and Sites

The Sites build creates a Worker bundle. Publishing a deployment and authorizing an X account are separate owner actions.

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
