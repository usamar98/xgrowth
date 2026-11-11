CREATE TABLE draft_media(
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, media_type TEXT NOT NULL, bytes INTEGER NOT NULL,
 alt TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX draft_media_owner ON draft_media(owner,draft_id,position);
CREATE TRIGGER media_added AFTER INSERT ON draft_media BEGIN
 UPDATE drafts SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner=NEW.owner AND id=NEW.draft_id;
END;
CREATE TRIGGER media_changed AFTER UPDATE OF alt,position ON draft_media BEGIN
 UPDATE drafts SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner=NEW.owner AND id=NEW.draft_id;
END;
CREATE TRIGGER media_removed AFTER DELETE ON draft_media BEGIN
 UPDATE drafts SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner=OLD.owner AND id=OLD.draft_id;
END;
