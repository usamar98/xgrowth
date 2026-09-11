CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`x_user_id` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`tokens` text NOT NULL,
	`expires` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_accounts_owner` ON `accounts` (`owner`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_owner_x_user` ON `accounts` (`owner`,`x_user_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`account_id` text,
	`text` text NOT NULL,
	`pillar` text DEFAULT 'Teach' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`planned_at` text,
	`post_id` text,
	`last_error` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_drafts_owner_updated` ON `drafts` (`owner`,`updated_at`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`verifier` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`topics` text DEFAULT '' NOT NULL,
	`weekly_target` integer DEFAULT 3 NOT NULL,
	`budget` integer DEFAULT 10000000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage` (
	`key` text PRIMARY KEY NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL
);
