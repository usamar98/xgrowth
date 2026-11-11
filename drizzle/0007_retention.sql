ALTER TABLE settings ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 30;
CREATE TRIGGER remove_rules_for_disconnected_account AFTER DELETE ON accounts BEGIN
 UPDATE desk_rules SET enabled=0 WHERE owner=OLD.owner AND account_id=OLD.id;
 UPDATE desk_api_keys SET revoked=1 WHERE owner=OLD.owner AND account_id=OLD.id;
END;
