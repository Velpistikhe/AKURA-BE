-- Keep the newest billing document per (branch, kind, quotation) and hard-delete older duplicates.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY office_branch_id, kind, quotation_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM billing_documents
  WHERE quotation_id IS NOT NULL
),
dup AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM billing_documents_histories WHERE document_id IN (SELECT id FROM dup);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY office_branch_id, kind, quotation_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM billing_documents
  WHERE quotation_id IS NOT NULL
),
dup AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM billing_document_items WHERE document_id IN (SELECT id FROM dup);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY office_branch_id, kind, quotation_id
    ORDER BY created_at DESC, id DESC
  ) AS rn
  FROM billing_documents
  WHERE quotation_id IS NOT NULL
),
dup AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM billing_documents WHERE id IN (SELECT id FROM dup);

ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS contract_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS billing_documents_office_branch_id_kind_quotation_id_key
  ON billing_documents (office_branch_id, kind, quotation_id);

CREATE UNIQUE INDEX IF NOT EXISTS billing_documents_office_branch_id_kind_contract_id_key
  ON billing_documents (office_branch_id, kind, contract_id);
