import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { RevisionStore } from "./store.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const production = process.argv.includes("--production");
const port = Number(process.env.TESSERA_PORT || (production ? 4178 : 4311));
const stateFile = path.resolve(
  projectDir,
  process.env.TESSERA_DATA_FILE || ".tessera-data/state.json",
);
const store = new RevisionStore({
  file: stateFile,
  memoryOnly: process.env.TESSERA_TEST_MODE === "1",
});
await store.load();
const stateSubscribers = new Set();
const uploadDirectory = path.resolve(projectDir, ".tessera-data", "uploads");
const memoryUploads = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (
      url.pathname === "/api/test/reset" &&
      request.method === "POST" &&
      process.env.TESSERA_TEST_MODE === "1"
    ) {
      memoryUploads.clear();
      const envelope = store.resetMemory();
      broadcastState(envelope, null);
      return json(response, 200, envelope);
    }
    if (url.pathname === "/api/health")
      return json(response, 200, { ok: true, revision: store.read().revision });
    if (url.pathname === "/api/uploads" && request.method === "POST")
      return saveUpload(request, response, url);
    if (url.pathname === "/api/uploads" && request.method === "GET")
      return readUpload(response, url);
    if (url.pathname === "/api/state/events" && request.method === "GET")
      return subscribeToState(request, response);
    if (url.pathname === "/api/state" && request.method === "GET")
      return json(response, 200, store.read());
    if (url.pathname === "/api/state" && request.method === "PUT") {
      const body = await readJson(request);
      try {
        const envelope = await store.write(
          Number(body.expectedRevision),
          body.state,
        );
        broadcastState(
          envelope,
          request.headers["x-tessera-client-id"] || null,
        );
        return json(response, 200, envelope);
      } catch (error) {
        if (error?.code === "REVISION_CONFLICT")
          return json(response, 409, error.current);
        throw error;
      }
    }
    if (url.pathname.startsWith("/api/"))
      return json(response, 404, { error: "API route not found" });
    if (!production)
      return json(response, 404, {
        error: "Use the Vite development URL at http://127.0.0.1:5178.",
      });
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return json(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
});

async function saveUpload(request, response, url) {
  const fileName = safeUploadName(url.searchParams.get("filename"));
  const bytes = await readBinary(request, 25 * 1024 * 1024);
  if (!bytes.length) return json(response, 400, { error: "Upload is empty." });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `uploads/${randomUUID()}/${fileName}`;
  const contentType =
    String(request.headers["content-type"] || "application/octet-stream")
      .split(";")[0]
      .trim() || "application/octet-stream";
  if (process.env.TESSERA_TEST_MODE === "1") {
    memoryUploads.set(storageKey, { bytes, fileName, contentType, checksum });
  } else {
    const target = path.resolve(projectDir, ".tessera-data", storageKey);
    if (!target.startsWith(uploadDirectory + path.sep))
      return json(response, 400, { error: "Invalid upload path." });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
  return json(response, 201, {
    storageKey,
    fileName,
    contentType,
    byteLength: bytes.length,
    checksum,
  });
}

async function readUpload(response, url) {
  const storageKey = String(url.searchParams.get("key") || "");
  if (!/^uploads\/[0-9a-f-]+\/[^/]+$/i.test(storageKey))
    return json(response, 400, { error: "Invalid upload key." });
  const memory = memoryUploads.get(storageKey);
  let bytes;
  let fileName = safeUploadName(storageKey.split("/").at(-1));
  let contentType = "application/octet-stream";
  if (memory) {
    ({ bytes, fileName, contentType } = memory);
  } else {
    const target = path.resolve(projectDir, ".tessera-data", storageKey);
    if (!target.startsWith(uploadDirectory + path.sep))
      return json(response, 400, { error: "Invalid upload path." });
    try {
      bytes = await readFile(target);
    } catch {
      return json(response, 404, { error: "Original upload not found." });
    }
  }
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": bytes.length,
    "cache-control": "private, max-age=31536000, immutable",
    "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
  response.end(bytes);
}

function subscribeToState(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders?.();
  const subscriber = { response };
  stateSubscribers.add(subscriber);
  sendStateEvent(response, store.read(), null);
  const heartbeat = setInterval(
    () => response.write(": keep-alive\n\n"),
    15_000,
  );
  const close = () => {
    clearInterval(heartbeat);
    stateSubscribers.delete(subscriber);
  };
  request.once("close", close);
  response.once("close", close);
}

function broadcastState(envelope, originClientId) {
  for (const subscriber of stateSubscribers) {
    try {
      sendStateEvent(subscriber.response, envelope, originClientId);
    } catch {
      stateSubscribers.delete(subscriber);
    }
  }
}

function sendStateEvent(response, envelope, originClientId) {
  response.write(
    `event: state\ndata: ${JSON.stringify({ ...envelope, originClientId })}\n\n`,
  );
}

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Tessera ${production ? "production" : "API"} server: http://127.0.0.1:${port}`,
  );
  if (!process.env.TESSERA_TEST_MODE)
    console.log(`State: ${path.relative(projectDir, stateFile)}`);
});

async function readJson(request) {
  return JSON.parse(
    (await readBinary(request, 25 * 1024 * 1024)).toString("utf8") || "{}",
  );
}

async function readBinary(request, maximumBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes)
      throw new RangeError(`Request body exceeds ${maximumBytes} bytes.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeUploadName(value) {
  const safe = path
    .basename(String(value || "source-upload"))
    .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
    .slice(0, 180);
  return safe || "source-upload";
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function serveStatic(pathname, response) {
  const distDir = path.resolve(projectDir, "dist", "client");
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  let target = path.resolve(distDir, requested);
  if (!target.startsWith(distDir + path.sep)) return json(response, 403, {});
  try {
    if (!(await stat(target)).isFile()) throw new Error("not a file");
  } catch {
    target = path.join(distDir, "index.html");
  }
  const extension = path.extname(target);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
  };
  response.writeHead(200, {
    "content-type": types[extension] || "application/octet-stream",
    "cache-control":
      extension === ".html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
  });
  response.end(await readFile(target));
}
