-- Existing installations predate candidate ownership on scores and pursuits.
-- Prefer the declared default, then the canonical slug, then the oldest row.
-- A legacy database with private rows but no candidate gets a recoverable
-- placeholder that the normal profile sync updates by the stable `default`
-- slug on its next explicit seed.
INSERT INTO `candidate` (`slug`, `name`, `is_default`)
SELECT 'default', 'Default candidate', 1
WHERE NOT EXISTS (SELECT 1 FROM `candidate`)
  AND (
    EXISTS (SELECT 1 FROM `application` WHERE `candidate_id` IS NULL)
    OR EXISTS (SELECT 1 FROM `job_score` WHERE `candidate_id` IS NULL)
  );--> statement-breakpoint

UPDATE `application`
SET `candidate_id` = COALESCE(
  (SELECT `id` FROM `candidate` WHERE `is_default` = 1 ORDER BY `id` LIMIT 1),
  (SELECT `id` FROM `candidate` WHERE `slug` = 'default' ORDER BY `id` LIMIT 1),
  (SELECT `id` FROM `candidate` ORDER BY `id` LIMIT 1)
)
WHERE `candidate_id` IS NULL;--> statement-breakpoint

UPDATE `job_score`
SET `candidate_id` = COALESCE(
  (SELECT `id` FROM `candidate` WHERE `is_default` = 1 ORDER BY `id` LIMIT 1),
  (SELECT `id` FROM `candidate` WHERE `slug` = 'default' ORDER BY `id` LIMIT 1),
  (SELECT `id` FROM `candidate` ORDER BY `id` LIMIT 1)
)
WHERE `candidate_id` IS NULL;
