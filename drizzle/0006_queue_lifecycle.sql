CREATE TRIGGER queue_schedule_draft AFTER INSERT ON queue_jobs BEGIN
  UPDATE drafts SET status='scheduled',planned_at=new.run_at,updated_at=new.created_at
  WHERE owner=new.owner AND id=new.draft_id AND revision=new.revision;
END;
CREATE TRIGGER queue_sync_draft AFTER UPDATE OF status,run_at ON queue_jobs
WHEN new.status IN ('scheduled','dispatching','failed','blocked','canceled','outcome-unknown')
BEGIN
  UPDATE drafts SET
    status=CASE new.status WHEN 'dispatching' THEN 'publishing' WHEN 'outcome-unknown' THEN 'uncertain' ELSE new.status END,
    planned_at=CASE WHEN new.status='scheduled' THEN new.run_at ELSE planned_at END,
    last_error=new.detail,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE owner=new.owner AND id=new.draft_id AND revision=new.revision;
END;
CREATE TRIGGER queue_stop_revoked_account AFTER UPDATE OF health ON accounts
WHEN new.health<>'connected' BEGIN
  UPDATE queue_jobs SET status='blocked',detail='Reconnect this X identity and review the approved version.'
    WHERE account_id=new.id AND owner=new.owner AND status IN ('scheduled','processing');
END;
CREATE TRIGGER queue_resolve_reply AFTER UPDATE OF status ON queue_jobs
WHEN new.kind='reply' AND new.status='published' BEGIN
  UPDATE inbox_items SET status='resolved' WHERE owner=new.owner AND account_id=new.account_id AND post_id=new.target_id;
END;
