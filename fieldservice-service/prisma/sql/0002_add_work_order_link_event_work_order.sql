-- Denormalises the Work Order reference out of the Work Order link event
-- payload.
--
-- The payload already carried the Work Order identity, but only inside a JSONB
-- document, so the synchronisation history of one Work Order could only be
-- read with a JSONB scan. The reference is copied into indexed columns, so
-- the monitoring endpoint can filter on it directly.
--
-- The file is idempotent, so it is safe to run more than once, and safe to
-- run before or after `prisma db push`. Existing rows are backfilled from
-- the payload they already carry.

-- Fail early and loudly if the table does not exist yet.
DO $$
BEGIN
  IF to_regclass('public.work_order_link_events') IS NULL THEN
    RAISE EXCEPTION 'public.work_order_link_events does not exist; run the schema push first';
  END IF;
END
$$;

ALTER TABLE work_order_link_events
  ADD COLUMN IF NOT EXISTS work_order_id uuid,
  ADD COLUMN IF NOT EXISTS work_order_number varchar(100),
  ADD COLUMN IF NOT EXISTS work_order_status varchar(20),
  ADD COLUMN IF NOT EXISTS action varchar(20),
  ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false;

-- The Work Order identity is copied out of the payload the events already
-- store. A payload without a Work Order ID cannot be attributed to one, so
-- such a row is dropped rather than kept with an unusable reference.
UPDATE work_order_link_events
SET work_order_id = (payload->>'workOrderId')::uuid
WHERE work_order_id IS NULL
  AND payload ? 'workOrderId'
  AND NULLIF(payload->>'workOrderId', '') IS NOT NULL;

DELETE FROM work_order_link_events
WHERE work_order_id IS NULL;

UPDATE work_order_link_events
SET work_order_number = COALESCE(NULLIF(payload->>'workOrderNumber', ''), 'UNKNOWN')
WHERE work_order_number IS NULL;

UPDATE work_order_link_events
SET work_order_status = COALESCE(NULLIF(payload->>'workOrderStatus', ''), 'UNKNOWN')
WHERE work_order_status IS NULL;

-- The revoked flag is the only signal the payload carries about the kind of
-- event, so it is read before the action is derived from it.
UPDATE work_order_link_events
SET revoked = COALESCE((payload->>'revoked')::boolean, false)
WHERE revoked = false
  AND payload ? 'revoked';

-- The action cannot be reconstructed from the payload alone, so a legacy row
-- is recorded with the action its revoked flag implies.
UPDATE work_order_link_events
SET action = CASE WHEN revoked THEN 'REVOKE' ELSE 'CREATE' END
WHERE action IS NULL;

ALTER TABLE work_order_link_events
  ALTER COLUMN work_order_id SET NOT NULL,
  ALTER COLUMN work_order_number SET NOT NULL,
  ALTER COLUMN work_order_status SET NOT NULL,
  ALTER COLUMN action SET NOT NULL;

CREATE INDEX IF NOT EXISTS work_order_link_events_work_order_id_created_at_idx
  ON work_order_link_events (work_order_id, created_at);