// supabase/functions/cloud-upload/index.ts
// Server-side proxy upload: browser POSTs file bytes here, we PUT to iDrive S3.
// Avoids browser->S3 CORS (iDrive bucket has no CORS policy for sosainc.xyz).
// Metadata passed via headers (x-file-*); body is raw file bytes.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  Deno.env.get("FRONTEND_URL") || "http://localhost:8080",
  "https://sosainc.xyz",
  "https://www.sosainc.xyz",
  "https://sosa-inc.vercel.app",
  "http://localhost:8080",
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-file-id, x-file-name, x-mime-type, x-portal-id, x-folder-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const BUCKET = "sosa-cloud-prod";
const REGION = "eu-central-1";
const ENDPOINT = "https://s3.eu-central-1.idrivee2.com";

function getS3Client(): S3Client {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: Deno.env.get("IDRIVE_E2_ACCESS_KEY_ID") ?? "",
      secretAccessKey: Deno.env.get("IDRIVE_E2_SECRET_ACCESS_KEY") ?? "",
    },
    forcePathStyle: true,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  try {
    const portalId = req.headers.get("x-portal-id") ?? "";
    const folderId = req.headers.get("x-folder-id") ?? "";
    const rawName = req.headers.get("x-file-name") ?? "";
    const fileName = rawName ? decodeURIComponent(rawName) : "";
    const mimeType = req.headers.get("x-mime-type") || "application/octet-stream";
    // fileId is generated server-side — never trust client (prevents overwriting
    // arbitrary existing S3 objects / cloud_files rows by ID collision).
    const fileId = crypto.randomUUID();

    if (!portalId || !fileName) return json({ error: "Missing file metadata headers" }, 400);

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: member } = await supabase
      .from("portal_members").select("role")
      .eq("portal_id", portalId).eq("user_id", user.id).maybeSingle();
    if (!member) return json({ error: "Not a portal member" }, 403);

    // Validate folder belongs to this portal (prevents IDOR: writing a file into
    // another portal's folder by passing its folder_id).
    if (folderId) {
      const { data: folder } = await supabase
        .from("cloud_folders").select("id")
        .eq("id", folderId).eq("portal_id", portalId).maybeSingle();
      if (!folder) return json({ error: "Invalid folder" }, 400);
    }

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length === 0) return json({ error: "Empty file body" }, 400);

    const s3Key = `${portalId}/${fileId}`;
    const s3 = getS3Client();
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: bytes,
      ContentType: mimeType,
    }));

    const { error: insErr } = await supabase.from("cloud_files").insert({
      id: fileId,
      portal_id: portalId,
      folder_id: folderId || null,
      name: fileName,
      size: bytes.length,
      mime_type: mimeType,
      s3_key: s3Key,
      uploaded_by: user.id,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    return json({ ok: true, id: fileId, size: bytes.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return json({ error: msg }, 500);
  }
});
