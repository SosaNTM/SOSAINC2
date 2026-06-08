/**
 * Maps portal slugs (used throughout the app) to their Supabase UUID portal_id values.
 * The slugs ('sosa', 'keylo', etc.) are what the app uses internally.
 * The UUIDs are what Supabase foreign keys reference.
 */
// These MUST match the actual public.portals.id values in Supabase.
// (Earlier they were 00000000-… which do not exist → every FK insert silently
//  failed, so vault items / files never persisted.)
export const PORTAL_UUID_MAP: Record<string, string> = {
  sosa:     "a1000000-0000-0000-0000-000000000001",
  keylo:    "a1000000-0000-0000-0000-000000000002",
  redx:     "a1000000-0000-0000-0000-000000000003",
  trustme:  "a1000000-0000-0000-0000-000000000004",
  "trust-me": "a1000000-0000-0000-0000-000000000004",
};

/**
 * Convert a portal slug to its Supabase UUID.
 * Falls back to the input value if the slug is not found
 * (handles cases where a UUID is accidentally passed directly).
 */
export function toPortalUUID(portalSlug: string): string {
  return PORTAL_UUID_MAP[portalSlug] ?? portalSlug;
}

/**
 * Convert a Supabase portal UUID back to a slug.
 * Useful when reading data from Supabase and needing the slug for local state.
 */
export function toPortalSlug(portalUUID: string): string {
  const entry = Object.entries(PORTAL_UUID_MAP).find(([, uuid]) => uuid === portalUUID);
  return entry ? entry[0] : portalUUID;
}
