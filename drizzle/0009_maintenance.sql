CREATE TABLE maintenance_ticks (
 name TEXT PRIMARY KEY, last_run INTEGER NOT NULL
);
CREATE TABLE obsolete_images (
 object_key TEXT PRIMARY KEY, owner TEXT NOT NULL, removed_at TEXT NOT NULL
);
CREATE TRIGGER enqueue_obsolete_image AFTER DELETE ON draft_media BEGIN
 INSERT OR IGNORE INTO obsolete_images(object_key,owner,removed_at)
 VALUES(OLD.object_key,OLD.owner,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
