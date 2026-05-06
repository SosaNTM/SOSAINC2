-- ============================================================================
-- cloud_files: file metadata for iDrive e2 S3-compatible storage
-- portal_id: UUID FK → portals.id (consistent with portal_members)
-- S3 key format: {portal_id}/{file_id}-{original_filename}
-- ============================================================================

CREATE TABLE IF NOT EXISTS cloud_files (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id    UUID        NOT NULL REFERENCES portals(id) ON DELETE CASCADE,
  folder_id    TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  size         BIGINT      NOT NULL DEFAULT 0,
  mime_type    TEXT        NOT NULL DEFAULT 'application/octet-stream',
  s3_key       TEXT        NOT NULL UNIQUE,
  uploaded_by  UUID        NOT NULL REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted   BOOLEAN     NOT NULL DEFAULT false,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID        REFERENCES auth.users(id)
);

ALTER TABLE cloud_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cloud_files_select" ON cloud_files
  FOR SELECT TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cloud_files_insert" ON cloud_files
  FOR INSERT TO authenticated
  WITH CHECK (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "cloud_files_update" ON cloud_files
  FOR UPDATE TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "cloud_files_delete" ON cloud_files
  FOR DELETE TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

CREATE INDEX IF NOT EXISTS idx_cloud_files_portal_folder
  ON cloud_files(portal_id, folder_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_cloud_files_portal_trash
  ON cloud_files(portal_id, deleted_at DESC)
  WHERE is_deleted = true;
