// supabase/functions/cloud-presign/index.ts
// Required secrets (set in Supabase Dashboard → Settings → Edge Functions → Secrets):
//   IDRIVE_E2_ACCESS_KEY_ID, IDRIVE_E2_SECRET_ACCESS_KEY, FRONTEND_URL
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../_shared/rateLimit.ts";

const ALLOWED_ORIGINS = [
  Deno.env.get("FRONTEND_URL") || "http://localhost:8080",
  "https://sosainc.xyz",
  "https://www.sosainc.xyz",
  "https://sosa-inc.vercel.app",
  "http://localhost:8080",
  "https://iconoff.io",
  "https://www.iconoff.io",
];

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const BUCKET = "sosa-cloud-prod";
const REGION = "eu-central-1";
const ENDPOINT = "https://s3.eu-central-1.idrivee2.com";
const PRESIGN_TTL_SECONDS = 300;

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  const rl = checkRateLimit(req);
  if (rl) return rl;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

  try {
    const { operation, portal_id, file_id, file_name, mime_type } =
      await req.json();

    if (!operation || !portal_id) return json({ error: "Missing operation or portal_id" }, 400);

    // Verify caller via Supabase Auth (no JWT secret needed)
    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);
    const userId = user.id;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: member } = await supabase
      .from("portal_members")
      .select("role")
      .eq("portal_id", portal_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!member) return json({ error: "Not a portal member" }, 403);

    const s3 = getS3Client();

    if (operation === "upload") {
      if (!file_id || !file_name) return json({ error: "Missing file_id or file_name" }, 400);
      const s3_key = `${portal_id}/${file_id}`;
      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: s3_key,
        ContentType: mime_type || "application/octet-stream",
      });
      const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });
      return json({ url, s3_key });
    }

    if (operation === "download") {
      if (!file_id) return json({ error: "Missing file_id" }, 400);
      const { data: fileRow } = await supabase
        .from("cloud_files")
        .select("s3_key, name")
        .eq("id", file_id)
        .eq("portal_id", portal_id)
        .maybeSingle();
      if (!fileRow) return json({ error: "File not found" }, 404);
      const row = fileRow as { s3_key: string; name: string };
      const safeFilename = encodeURIComponent(row.name).replace(/['"]/g, "");
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: row.s3_key,
        ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      });
      const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS });
      return json({ url });
    }

    if (operation === "delete") {
      if (!file_id) return json({ error: "Missing file_id" }, 400);
      const { data: fileRow } = await supabase
        .from("cloud_files")
        .select("s3_key")
        .eq("id", file_id)
        .eq("portal_id", portal_id)
        .maybeSingle();
      if (!fileRow) return json({ error: "File not found" }, 404);
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: (fileRow as { s3_key: string }).s3_key }));
      await supabase
        .from("cloud_files")
        .delete()
        .eq("id", file_id)
        .eq("portal_id", portal_id);
      return json({ ok: true });
    }

    return json({ error: "Unknown operation" }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
