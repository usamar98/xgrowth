CREATE TABLE queue_jobs (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL, account_id TEXT NOT NULL, x_user_id TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, target_id TEXT, provenance TEXT NOT NULL,
  campaign_id TEXT, digest TEXT NOT NULL, estimated_micros INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', run_at TEXT NOT NULL, timezone TEXT NOT NULL,
  created_at TEXT NOT NULL, approved_at TEXT NOT NULL, requested_by TEXT NOT NULL,
  lease TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  dispatch_at TEXT, detail TEXT, post_id TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX queue_due ON queue_jobs(status,run_at);
CREATE INDEX queue_owned ON queue_jobs(owner,created_at);
CREATE TRIGGER queue_updated AFTER UPDATE OF status ON queue_jobs BEGIN
 UPDATE queue_jobs SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=new.id;
END;
CREATE UNIQUE INDEX queue_draft_active ON queue_jobs(owner,draft_id)
  WHERE status IN ('scheduled','processing','dispatching','published','outcome-unknown');
CREATE UNIQUE INDEX queue_reply_active ON queue_jobs(owner,x_user_id,target_id)
  WHERE kind='reply' AND status IN ('scheduled','processing','dispatching','published','outcome-unknown');
CREATE TABLE queue_attempts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at TEXT NOT NULL, dispatch_at TEXT,
  finished_at TEXT, state TEXT NOT NULL, detail TEXT
);
CREATE INDEX queue_attempt_job ON queue_attempts(job_id);
ALTER TABLE settings ADD COLUMN actions_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN daily_budget INTEGER NOT NULL DEFAULT 2000000;
CREATE TABLE cost_entries (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, category TEXT NOT NULL, operation TEXT NOT NULL,
  state TEXT NOT NULL, micros INTEGER NOT NULL CHECK(micros>=0),
  reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),
  account_id TEXT, job_id TEXT, campaign_id TEXT, provider_reference TEXT, created_at TEXT NOT NULL
);
CREATE INDEX cost_entries_owner_date ON cost_entries(owner,created_at);
CREATE TRIGGER invalidate_queued_approval AFTER UPDATE OF revision ON drafts
WHEN new.revision<>old.revision BEGIN
  UPDATE queue_jobs SET status='canceled',detail='Approval invalidated by a draft edit.'
    WHERE owner=new.owner AND draft_id=new.id AND status IN ('scheduled','processing');
END;
CREATE TRIGGER freeze_inflight_draft BEFORE UPDATE OF revision ON drafts
WHEN new.revision<>old.revision AND EXISTS(
  SELECT 1 FROM queue_jobs WHERE draft_id=new.id AND owner=new.owner AND status IN ('dispatching','outcome-unknown'))
BEGIN SELECT RAISE(ABORT,'Delivery in progress or unconfirmed'); END;
CREATE TRIGGER cancel_deleted_draft AFTER DELETE ON drafts BEGIN
  UPDATE queue_jobs SET status='canceled', detail='Draft removed.'
    WHERE owner=old.owner AND draft_id=old.id AND status IN ('scheduled','processing');
END;
CREATE TRIGGER cancel_disconnected_account AFTER DELETE ON accounts BEGIN
  UPDATE queue_jobs SET status='blocked',detail='Account disconnected. Connect and approve a new delivery.'
    WHERE owner=old.owner AND account_id=old.id AND status IN ('scheduled','processing');
END;
CREATE TRIGGER remove_private_job_data AFTER DELETE ON settings BEGIN
  DELETE FROM queue_attempts WHERE job_id IN (SELECT id FROM queue_jobs WHERE owner=old.owner);
  DELETE FROM queue_jobs WHERE owner=old.owner;
  INSERT INTO usage(key,amount)
    SELECT old.owner||':'||substr(created_at,1,7),sum(micros)
      FROM cost_entries WHERE owner=old.owner AND state<>'released' GROUP BY substr(created_at,1,7)
      ON CONFLICT(key) DO UPDATE SET amount=amount+excluded.amount;
  DELETE FROM cost_entries WHERE owner=old.owner;
END;
CREATE TRIGGER protect_job_approval BEFORE UPDATE OF owner,draft_id,revision,account_id,x_user_id,kind,text,target_id,provenance,campaign_id,digest,estimated_micros,timezone,approved_at,requested_by ON queue_jobs
BEGIN SELECT RAISE(ABORT,'Approved payload is immutable'); END;
