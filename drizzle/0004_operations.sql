CREATE TABLE desk_rules (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, action TEXT NOT NULL,
 account_id TEXT, source_id TEXT, every_days INTEGER NOT NULL CHECK(every_days IN (1,7)),
 local_time TEXT NOT NULL, timezone TEXT NOT NULL, next_run TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX desk_rules_due ON desk_rules(enabled,next_run);
CREATE TABLE desk_runs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, rule_id TEXT NOT NULL REFERENCES desk_rules(id) ON DELETE CASCADE,
 slot TEXT NOT NULL, created_at TEXT NOT NULL, message TEXT NOT NULL, draft_id TEXT,
 UNIQUE(rule_id,slot)
);
CREATE TABLE desk_api_keys (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, account_id TEXT, label TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
 scopes TEXT NOT NULL, expires TEXT NOT NULL, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
 bucket INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE desk_access_log (id TEXT PRIMARY KEY, owner TEXT NOT NULL, key_id TEXT, operation TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX desk_access_owner ON desk_access_log(owner,created_at);
CREATE TABLE desk_events (
 id TEXT NOT NULL, owner TEXT NOT NULL, campaign_id TEXT NOT NULL, event TEXT NOT NULL, occurred_at TEXT NOT NULL,
 received_at TEXT NOT NULL, PRIMARY KEY(owner,id)
);
CREATE INDEX desk_events_campaign ON desk_events(owner,campaign_id,occurred_at);
CREATE TABLE desk_experiments (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, account_id TEXT NOT NULL, name TEXT NOT NULL,
 first_post TEXT NOT NULL, second_post TEXT NOT NULL, metric TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(first_post<>second_post)
);
