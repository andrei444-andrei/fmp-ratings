CREATE TABLE `grades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`new_grade` text,
	`previous_grade` text,
	`grading_company` text,
	`action` text
);
--> statement-breakpoint
CREATE INDEX `idx_grades_symbol` ON `grades` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_grades_date` ON `grades` (`date`);--> statement-breakpoint
CREATE TABLE `market_cap` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`market_cap` real NOT NULL,
	PRIMARY KEY(`symbol`, `date`)
);
--> statement-breakpoint
CREATE INDEX `idx_mcap_date` ON `market_cap` (`date`);--> statement-breakpoint
CREATE TABLE `rating_changes_filtered` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`date` text NOT NULL,
	`symbol` text NOT NULL,
	`new_rating` text,
	`previous_rating` text,
	`new_grade_raw` text,
	`previous_grade_raw` text,
	`grading_company` text,
	`action` text,
	`jump_size` integer,
	`min_jump` integer,
	`computed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rcf_year` ON `rating_changes_filtered` (`year`);--> statement-breakpoint
CREATE INDEX `idx_rcf_symbol` ON `rating_changes_filtered` (`symbol`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`start_year` integer,
	`end_year` integer,
	`top_n` integer,
	`min_jump` integer,
	`rows_written` integer,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `sp500_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`added_symbol` text,
	`removed_symbol` text,
	`reason` text,
	`raw` text
);
--> statement-breakpoint
CREATE INDEX `idx_sp500_changes_date` ON `sp500_changes` (`date`);--> statement-breakpoint
CREATE TABLE `sp500_current` (
	`symbol` text PRIMARY KEY NOT NULL,
	`name` text,
	`sector` text,
	`sub_sector` text,
	`founded` text,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `top_n_per_year` (
	`year` integer NOT NULL,
	`rank` integer NOT NULL,
	`symbol` text NOT NULL,
	`market_cap` real,
	`snapshot_date` text,
	PRIMARY KEY(`year`, `rank`)
);
--> statement-breakpoint
CREATE INDEX `idx_top_year` ON `top_n_per_year` (`year`);