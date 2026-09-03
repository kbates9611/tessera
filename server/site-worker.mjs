// Hosted state and uploads are isolated by an HttpOnly workspace cookie.

const WORKSPACE_COOKIE = "tessera_workspace";
const WORKSPACE_ID_PATTERN = /^[0-9a-f-]{36}$/;
const WORKSPACE_COOKIE_MAX_AGE = 31536000;
const UPLOAD_KEY_PATTERN = /^uploads\/([0-9a-f-]{36})\/[0-9a-f-]{36}\/[^/]+$/;

const STATE_SCHEMA = `CREATE TABLE IF NOT EXISTS tessera_workspace_state (
  workspace_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  state_json TEXT,
  updated_at TEXT NOT NULL
)`;

const UPLOAD_SCHEMA = `CREATE TABLE IF NOT EXISTS tessera_workspace_uploads (
  object_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

const UPLOAD_INDEX = `CREATE INDEX IF NOT EXISTS tessera_workspace_uploads_workspace_created_at_idx
  ON tessera_workspace_uploads (workspace_id, created_at)`;

export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    const workspace = resolveWorkspace(request);

    if (url.pathname.startsWith("/api/")) {
      let response;
      try {
        response = await handleApi(request, environment, url, workspace);
      } catch (error) {
        response = json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Unexpected hosted storage error",
          },
          500,
        );
      }
      return withWorkspaceCookie(response, workspace);
    }

    const assetResponse = await environment.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || request.method !== "GET") {
      const isDocument = url.pathname === "/" || url.pathname === "/index.html";
      return isDocument
        ? withWorkspaceCookie(assetResponse, workspace)
        : assetResponse;
    }

    const fallbackUrl = new URL("/index.html", request.url);
    const fallbackResponse = await environment.ASSETS.fetch(
      new Request(fallbackUrl, request),
    );
    return withWorkspaceCookie(fallbackResponse, workspace);
  },
};

async function handleApi(request, environment, url, workspace) {
  if (url.pathname === "/api/health") {
    const envelope = await readEnvelope(environment, workspace.id);
    return json({ ok: true, revision: envelope.revision });
  }
  if (url.pathname === "/api/state" && request.method === "GET")
    return json(await readEnvelope(environment, workspace.id));
  if (url.pathname === "/api/state" && request.method === "PUT")
    return saveEnvelope(request, environment, workspace.id);
  if (url.pathname === "/api/state/events" && request.method === "GET")
    return stateEvent(environment, workspace.id);
  if (url.pathname === "/api/uploads" && request.method === "POST")
    return saveUpload(request, environment, url, workspace.id);
  if (url.pathname === "/api/uploads" && request.method === "GET")
    return readUpload(environment, url, workspace.id);
  return json({ error: "API route not found" }, 404);
}

function resolveWorkspace(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== WORKSPACE_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    if (WORKSPACE_ID_PATTERN.test(value)) return { id: value, setCookie: null };
  }
  const id = crypto.randomUUID();
  return {
    id,
    setCookie: `${WORKSPACE_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${WORKSPACE_COOKIE_MAX_AGE}`,
  };
}

function withWorkspaceCookie(response, workspace) {
  if (!workspace.setCookie) return response;
  const patched = new Response(response.body, response);
  patched.headers.append("set-cookie", workspace.setCookie);
  return patched;
}

let schemaReady = null;

function ensureSchema(environment) {
  if (!environment.DB)
    return Promise.reject(
      new Error("Hosted database binding DB is unavailable."),
    );
  if (!schemaReady)
    schemaReady = environment.DB.batch([
      environment.DB.prepare(STATE_SCHEMA),
      environment.DB.prepare(UPLOAD_SCHEMA),
      environment.DB.prepare(UPLOAD_INDEX),
    ]).then(
      () => undefined,
      (error) => {
        schemaReady = null;
        throw error;
      },
    );
  return schemaReady;
}

async function readEnvelope(environment, workspaceId) {
  await ensureSchema(environment);
  const row = await environment.DB.prepare(
    "SELECT revision, state_json FROM tessera_workspace_state WHERE workspace_id = ?1",
  )
    .bind(workspaceId)
    .first();
  return {
    revision: Number(row?.revision ?? 0),
    state: row?.state_json ? JSON.parse(String(row.state_json)) : null,
  };
}

async function saveEnvelope(request, environment, workspaceId) {
  await ensureSchema(environment);
  const body = await request.json();
  const expectedRevision = Number(body?.expectedRevision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    return json(
      { error: "expectedRevision must be a non-negative integer" },
      400,
    );
  if (!body?.state || typeof body.state !== "object")
    return json({ error: "state must be an object" }, 400);

  const current = await environment.DB.prepare(
    "SELECT revision, state_json FROM tessera_workspace_state WHERE workspace_id = ?1",
  )
    .bind(workspaceId)
    .first();
  if (current && Number(current.revision) !== expectedRevision)
    return json(
      {
        revision: Number(current.revision),
        state: current.state_json
          ? JSON.parse(String(current.state_json))
          : null,
      },
      409,
    );
  if (!current && expectedRevision !== 0)
    return json({ revision: 0, state: null }, 409);

  const stateJson = JSON.stringify(body.state);
  const now = new Date().toISOString();
  // Conditional UPSERT: a concurrent first save for the same workspace (or a
  // stale expectedRevision that slipped past the pre-check) matches zero rows,
  // and the missing RETURNING row becomes a 409 carrying the live envelope.
  const updated = await environment.DB.prepare(
    `INSERT INTO tessera_workspace_state (workspace_id, revision, state_json, updated_at)
     VALUES (?1, 1, ?2, ?3)
     ON CONFLICT(workspace_id) DO UPDATE SET
       revision = tessera_workspace_state.revision + 1,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at
     WHERE tessera_workspace_state.revision = ?4
     RETURNING revision`,
  )
    .bind(workspaceId, stateJson, now, expectedRevision)
    .first();

  if (!updated) return json(await readEnvelope(environment, workspaceId), 409);
  return json({ revision: Number(updated.revision), state: body.state });
}

async function stateEvent(environment, workspaceId) {
  const envelope = await readEnvelope(environment, workspaceId);
  // One-shot stream: the browser reconnects after `retry` ms and each reconnect
  // costs a D1 read, so keep the interval long.
  return new Response(
    `retry: 30000\nevent: state\ndata: ${JSON.stringify({ ...envelope, originClientId: null })}\n\n`,
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    },
  );
}

async function saveUpload(request, environment, url, workspaceId) {
  await ensureSchema(environment);
  if (!environment.FILES)
    throw new Error("Hosted object-storage binding FILES is unavailable.");
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 25 * 1024 * 1024)
    return json({ error: "Upload exceeds 25 MB." }, 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "Upload is empty." }, 400);
  if (bytes.byteLength > 25 * 1024 * 1024)
    return json({ error: "Upload exceeds 25 MB." }, 413);

  const fileName = safeUploadName(url.searchParams.get("filename"));
  const contentType =
    request.headers.get("content-type")?.split(";")[0].trim() ||
    "application/octet-stream";
  const checksum = await sha256(bytes);
  const storageKey = `uploads/${workspaceId}/${crypto.randomUUID()}/${fileName}`;
  const createdAt = new Date().toISOString();

  await environment.FILES.put(storageKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { workspaceId, fileName, checksum, createdAt },
  });
  await environment.DB.prepare(
    `INSERT INTO tessera_workspace_uploads
      (object_key, workspace_id, file_name, content_type, byte_length, sha256, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      storageKey,
      workspaceId,
      fileName,
      contentType,
      bytes.byteLength,
      checksum,
      createdAt,
    )
    .run();

  return json(
    {
      storageKey,
      fileName,
      contentType,
      byteLength: bytes.byteLength,
      checksum,
    },
    201,
  );
}

async function readUpload(environment, url, workspaceId) {
  if (!environment.FILES)
    throw new Error("Hosted object-storage binding FILES is unavailable.");
  const storageKey = String(url.searchParams.get("key") || "");
  const match = UPLOAD_KEY_PATTERN.exec(storageKey);
  if (!match) return json({ error: "Invalid upload key." }, 400);
  // A key from another workspace is indistinguishable from a missing one.
  if (match[1] !== workspaceId)
    return json({ error: "Original upload not found." }, 404);
  const object = await environment.FILES.get(storageKey);
  if (!object) return json({ error: "Original upload not found." }, 404);
  const fileName =
    object.customMetadata?.fileName ||
    safeUploadName(storageKey.split("/").at(-1));
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set(
    "content-disposition",
    `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  return new Response(object.body, { headers });
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function safeUploadName(value) {
  const safe = String(value || "source-upload")
    .split(/[\\/]/)
    .at(-1)
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .slice(0, 180);
  return safe || "source-upload";
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
