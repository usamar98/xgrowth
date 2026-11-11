CREATE TABLE IF NOT EXISTS x_account_ids(owner TEXT NOT NULL,x_user_id TEXT NOT NULL,account_id TEXT NOT NULL,PRIMARY KEY(owner,x_user_id));
INSERT OR IGNORE INTO x_account_ids SELECT owner,x_user_id,id FROM accounts;
