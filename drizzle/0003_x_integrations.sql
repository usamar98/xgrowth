ALTER TABLE accounts ADD COLUMN granted_scopes TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN health TEXT NOT NULL DEFAULT 'connected';
ALTER TABLE accounts ADD COLUMN last_sync TEXT;
ALTER TABLE settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';
CREATE TABLE x_owned_posts (
 owner TEXT NOT NULL, account_id TEXT NOT NULL, id TEXT NOT NULL,
 author_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT, fetched_at TEXT NOT NULL,
 public_metrics TEXT, status TEXT NOT NULL DEFAULT 'published', PRIMARY KEY(owner,account_id,id));
CREATE TABLE x_profile_snapshots (
 owner TEXT NOT NULL,account_id TEXT NOT NULL,observed_at TEXT NOT NULL,name TEXT NOT NULL,username TEXT NOT NULL,
 public_metrics TEXT,PRIMARY KEY(owner,account_id,observed_at));
CREATE TABLE x_post_snapshots (
 owner TEXT NOT NULL,account_id TEXT NOT NULL,post_id TEXT NOT NULL,observed_at TEXT NOT NULL,
 public_metrics TEXT,PRIMARY KEY(owner,account_id,post_id,observed_at));
CREATE TABLE inbox_items (
 owner TEXT NOT NULL,account_id TEXT NOT NULL,post_id TEXT NOT NULL,author_id TEXT NOT NULL,
 author_name TEXT NOT NULL,author_username TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT,fetched_at TEXT NOT NULL,
 source TEXT NOT NULL,evidence_type TEXT NOT NULL,subject_x_id TEXT NOT NULL,quoted_post_id TEXT,verified_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',snoozed_until TEXT,note TEXT NOT NULL DEFAULT '',labels TEXT NOT NULL DEFAULT '[]',
 campaign_id TEXT,opt_out INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,account_id,post_id));
CREATE TABLE x_opt_out(owner TEXT NOT NULL,account_id TEXT NOT NULL,author_id TEXT NOT NULL,PRIMARY KEY(owner,account_id,author_id));
CREATE TABLE x_sync_pages(owner TEXT NOT NULL,account_id TEXT NOT NULL,kind TEXT NOT NULL,next_token TEXT,PRIMARY KEY(owner,account_id,kind));
CREATE TABLE x_delete_previews(id TEXT PRIMARY KEY,owner TEXT NOT NULL,account_id TEXT NOT NULL,post_ids TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX x_inbox_recent ON inbox_items(owner,account_id,fetched_at DESC);
CREATE INDEX x_posts_recent ON x_owned_posts(owner,account_id,created_at DESC);
