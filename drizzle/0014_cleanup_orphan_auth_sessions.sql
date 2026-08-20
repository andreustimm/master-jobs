-- Historical databases may contain sessions whose users were removed before
-- the foreign-key contract was enforced. They are invalid credentials, not
-- user-owned history, so removing only those rows is safe and idempotent.
DELETE FROM `auth_session`
WHERE NOT EXISTS (
  SELECT 1
  FROM `auth_user`
  WHERE `auth_user`.`id` = `auth_session`.`user_id`
);
--> statement-breakpoint

-- Audit events are user-owned history and `user_id` is nullable by design.
-- Preserve the event while removing the invalid reference, matching the
-- declared ON DELETE SET NULL semantics.
UPDATE `auth_event`
SET `user_id` = NULL
WHERE `user_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `auth_user`
    WHERE `auth_user`.`id` = `auth_event`.`user_id`
  );
