-- Fix leadgen tables: replace USING(true) with portal-scoped isolation.
-- Previously any authenticated user could read all portals' CRM data.

-- Helper: membership check reused in all policies
-- (portal_id must appear in the user's portal_members rows)

DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'leadgen_leads',
    'leadgen_touchpoints',
    'leadgen_pipelines',
    'leadgen_stages',
    'leadgen_pipeline_leads',
    'leadgen_activities'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    -- Drop the permissive USING(true) policy (name may vary)
    EXECUTE format('DROP POLICY IF EXISTS "Enable read access for all users" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable update for users based on email" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Enable delete for users based on email" ON %I', tbl);
    -- Also drop any catch-all names
    EXECUTE format('DROP POLICY IF EXISTS "allow_all" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "enable_all" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_all" ON %I', tbl);

    -- Create portal-scoped policies
    EXECUTE format($sql$
      CREATE POLICY "portal_members_select" ON %I
        FOR SELECT USING (
          portal_id IN (
            SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
          )
        )
    $sql$, tbl);

    EXECUTE format($sql$
      CREATE POLICY "portal_members_insert" ON %I
        FOR INSERT WITH CHECK (
          portal_id IN (
            SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
          )
        )
    $sql$, tbl);

    EXECUTE format($sql$
      CREATE POLICY "portal_members_update" ON %I
        FOR UPDATE USING (
          portal_id IN (
            SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
          )
        )
    $sql$, tbl);

    EXECUTE format($sql$
      CREATE POLICY "portal_members_delete" ON %I
        FOR DELETE USING (
          portal_id IN (
            SELECT portal_id FROM portal_members WHERE user_id = auth.uid()
          )
        )
    $sql$, tbl);
  END LOOP;
END $$;
