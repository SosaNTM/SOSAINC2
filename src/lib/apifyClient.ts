const BASE = "https://api.apify.com/v2";
const DEFAULT_ACTOR_ID = "nwua9Gu5YrADL7ZDj"; // compass/crawler-google-places

// The settings UI historically defaulted to a non-existent actor slug, which Apify
// rejects with 404 "Actor with this name was not found". Normalize any stored value.
const BAD_ACTOR_SLUGS = new Set(["compass~google-maps-scraper", "compass/google-maps-scraper"]);
function normalizeActorId(actorId?: string): string {
  if (!actorId || BAD_ACTOR_SLUGS.has(actorId)) return DEFAULT_ACTOR_ID;
  return actorId;
}

function headers(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function apifyFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(token) });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Token Apify non valido — controlla le impostazioni");
    if (res.status === 403) throw new Error("Token senza i permessi necessari — assicurati di aver cliccato \"Try for free\" sull'actor");
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Apify ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface StartRunInput {
  searchStringsArray: string[];
  locationQuery: string;
  language?: string;
  maxCrawledPlacesPerSearch?: number;
  scrapeContacts?: boolean;
  actorId?: string;
}

export interface RunStartResult {
  runId: string;
  defaultDatasetId: string;
}

export interface RunStatusResult {
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED" | "TIMED-OUT";
  defaultDatasetId: string;
}

export async function startGoogleMapsRun(
  token: string,
  input: StartRunInput
): Promise<RunStartResult> {
  const body = {
    searchStringsArray: input.searchStringsArray,
    locationQuery: input.locationQuery,
    language: input.language ?? "it",
    maxCrawledPlacesPerSearch: input.maxCrawledPlacesPerSearch ?? 50,
    scrapeContacts: input.scrapeContacts ?? true,
  };
  const actorId = normalizeActorId(input.actorId);
  const res = await apifyFetch<{ data: { id: string; defaultDatasetId: string } }>(
    token,
    `/acts/${actorId}/runs?memory=8192`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return { runId: res.data.id, defaultDatasetId: res.data.defaultDatasetId };
}

export async function getRunStatus(token: string, runId: string, actorId?: string): Promise<RunStatusResult> {
  const actor = normalizeActorId(actorId);
  const res = await apifyFetch<{
    data: { status: RunStatusResult["status"]; defaultDatasetId: string };
  }>(token, `/acts/${actor}/runs/${runId}`);
  return { status: res.data.status, defaultDatasetId: res.data.defaultDatasetId };
}

export async function getDatasetItems<T = unknown>(
  token: string,
  datasetId: string
): Promise<T[]> {
  const res = await apifyFetch<unknown>(
    token,
    `/datasets/${datasetId}/items?format=json&clean=true`
  );
  // Apify returns array directly for /items endpoint
  return Array.isArray(res) ? (res as T[]) : ((res as { items?: T[] }).items ?? []);
}

export async function testConnection(token: string): Promise<{ username: string }> {
  const res = await apifyFetch<{ data: { username: string } }>(token, "/users/me");
  return { username: res.data.username };
}

export async function abortRun(token: string, runId: string): Promise<void> {
  await apifyFetch(token, `/runs/${runId}/abort`, { method: "POST" });
}
