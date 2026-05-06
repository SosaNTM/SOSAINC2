-- Fix: restrict cloud_files UPDATE to uploader or owner/admin role
DROP POLICY IF EXISTS "cloud_files_update" ON cloud_files;

CREATE POLICY "cloud_files_update" ON cloud_files
  FOR UPDATE TO authenticated
  USING (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
    AND (
      uploaded_by = auth.uid()
      OR portal_id IN (
        SELECT portal_id FROM portal_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  )
  WITH CHECK (
    portal_id IN (
      SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
    )
    AND (
      uploaded_by = auth.uid()
      OR portal_id IN (
        SELECT portal_id FROM portal_members
        WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
      )
    )
  );
