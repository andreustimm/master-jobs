-- Resolve legacy labels to the newest matching document owned by the same
-- candidate. Rows without an exact, unambiguous ownership match stay null:
-- no document is better than a fabricated audit trail.
UPDATE `application`
SET `candidate_document_id` = (
  SELECT MAX(`candidate_document`.`id`)
  FROM `candidate_document`
  WHERE `candidate_document`.`candidate_id` = `application`.`candidate_id`
    AND `candidate_document`.`label` = `application`.`cv_variant`
)
WHERE `candidate_document_id` IS NULL
  AND `cv_variant` IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM `candidate_document`
    WHERE `candidate_document`.`candidate_id` = `application`.`candidate_id`
      AND `candidate_document`.`label` = `application`.`cv_variant`
  );
