ALTER TABLE drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post';
ALTER TABLE drafts ADD COLUMN target_id TEXT;
ALTER TABLE drafts ADD COLUMN provenance TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE drafts ADD COLUMN parts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN folder TEXT NOT NULL DEFAULT '';
ALTER TABLE drafts ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN campaign_id TEXT;
ALTER TABLE drafts ADD COLUMN knowledge_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE drafts ADD COLUMN voice_id TEXT;
ALTER TABLE drafts ADD COLUMN intent TEXT NOT NULL DEFAULT 'answer';
CREATE TABLE creative_entries (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('campaign','voice','knowledge','idea','snippet')),
 title TEXT NOT NULL, content TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', tags TEXT NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX creative_entries_owner ON creative_entries(owner,kind,updated_at);
CREATE TABLE draft_versions (
 draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE, owner TEXT NOT NULL,
 revision INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY (draft_id,revision)
);
INSERT INTO draft_versions SELECT id,owner,revision,json_object('text',text,'account_id',account_id,'pillar',pillar,'planned_at',planned_at,'kind',kind,'target_id',target_id,'provenance',provenance,'parts',parts,'folder',folder,'tags',tags,'campaign_id',campaign_id,'knowledge_ids',knowledge_ids,'voice_id',voice_id,'intent',intent),updated_at FROM drafts;
CREATE TRIGGER creative_version_insert AFTER INSERT ON drafts BEGIN
 INSERT INTO draft_versions VALUES (NEW.id,NEW.owner,NEW.revision,json_object('text',NEW.text,'account_id',NEW.account_id,'pillar',NEW.pillar,'planned_at',NEW.planned_at,'kind',NEW.kind,'target_id',NEW.target_id,'provenance',NEW.provenance,'parts',NEW.parts,'folder',NEW.folder,'tags',NEW.tags,'campaign_id',NEW.campaign_id,'knowledge_ids',NEW.knowledge_ids,'voice_id',NEW.voice_id,'intent',NEW.intent),NEW.updated_at);
END;
CREATE TRIGGER creative_version_update AFTER UPDATE OF revision ON drafts WHEN OLD.revision<>NEW.revision BEGIN
 INSERT INTO draft_versions VALUES (NEW.id,NEW.owner,NEW.revision,json_object('text',NEW.text,'account_id',NEW.account_id,'pillar',NEW.pillar,'planned_at',NEW.planned_at,'kind',NEW.kind,'target_id',NEW.target_id,'provenance',NEW.provenance,'parts',NEW.parts,'folder',NEW.folder,'tags',NEW.tags,'campaign_id',NEW.campaign_id,'knowledge_ids',NEW.knowledge_ids,'voice_id',NEW.voice_id,'intent',NEW.intent),NEW.updated_at);
END;
CREATE TABLE creative_generations (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, draft_id TEXT NOT NULL, model TEXT NOT NULL,
 created_at TEXT NOT NULL, state TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER
);
CREATE INDEX creative_generation_limits ON creative_generations(owner,created_at);
