import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { betterAuth } from "better-auth";
import {
  buildAskAiPrompt,
  buildPrompt,
  buildSummarizerPrompt,
} from "../src/lib/prompt";
import { interviewContextPatchSchema } from "../src/schemas/interview-context";

type SessionUser = {
  id: string;
  name: string;
  email: string;
  isApproved?: boolean;
};

type CompletionBody = {
  bg?: string;
  flag?: string;
  prompt?: string;
  image?: string | string[];
  messages?: Array<{
    role: "user" | "assistant";
    text: string;
    images?: string[];
  }>;
};

function loadDevVars() {
  const path = resolve(import.meta.dir, "..", ".dev.vars");
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (Bun.env[key] === undefined) Bun.env[key] = value;
    }
  } catch {
    // The local server also works without a .dev.vars file. AI and audio
    // routes explain which optional key is missing when they are used.
  }
}

loadDevVars();

const port = Number(Bun.env.PORT || 8787);
const baseURL = Bun.env.BETTER_AUTH_URL || `http://localhost:${port}`;
const dbPath = resolve(
  import.meta.dir,
  "..",
  Bun.env.LOCAL_DB_PATH || ".local-data/copilot.sqlite",
);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    isApproved INTEGER NOT NULL DEFAULT 1,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS session_user_idx ON session(userId);
  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS user_interview_context (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    interviewNotes TEXT,
    resumeText TEXT,
    resumeFileName TEXT,
    jobDescription TEXT,
    englishLevel TEXT,
    responseLength TEXT,
    naturalEnglish INTEGER,
    updatedAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_note (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    tag TEXT NOT NULL DEFAULT 'Copilot',
    workspaceId TEXT,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS saved_note_user_created_idx
    ON saved_note(userId, createdAt);
`);

const localAuth = betterAuth({
  baseURL,
  database: db,
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      isApproved: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  trustedOrigins: [
    "null",
    "file://",
    "http://localhost:3000",
    "http://localhost:3001",
    baseURL,
  ],
  secret:
    Bun.env.BETTER_AUTH_SECRET ||
    "local-only-interview-copilot-secret-change-before-sharing",
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: false,
    },
  },
});

const allowedOrigins = new Set([
  "null",
  "file://",
  "http://localhost:3000",
  "http://localhost:3001",
  baseURL,
]);

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") || "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "http://localhost:3000",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  };
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    headers.set(key, String(value));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function currentUser(request: Request): Promise<SessionUser | null> {
  const result = await localAuth.api.getSession({ headers: request.headers });
  return (result?.user as SessionUser | undefined) ?? null;
}

async function requireUser(
  request: Request,
): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await currentUser(request);
  return user ? { user } : { response: json({ error: "Unauthorized" }, 401) };
}

function parseImage(input: string) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(
    input.trim(),
  );
  return match
    ? { inlineData: { mimeType: match[1], data: match[2] } }
    : null;
}

function geminiContents(body: CompletionBody) {
  if (body.messages?.length) {
    return body.messages.slice(-24).map((message, index) => {
      let text = message.text.slice(0, 8000);
      if (index === 0 && message.role === "user") {
        text = buildAskAiPrompt(body.bg?.slice(0, 16000), text);
      }
      const parts: Array<Record<string, unknown>> = [];
      for (const image of (message.images || []).slice(0, 4)) {
        const parsed = parseImage(image);
        if (parsed) parts.push(parsed);
      }
      parts.push({ text });
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts,
      };
    });
  }

  const prompt = (body.prompt || "").slice(0, 32000);
  const text =
    body.flag === "summarizer"
      ? buildSummarizerPrompt(prompt)
      : body.flag === "ask-ai"
        ? buildAskAiPrompt(body.bg?.slice(0, 16000), prompt)
        : buildPrompt(body.bg?.slice(0, 16000), prompt);
  const images = Array.isArray(body.image) ? body.image : [body.image];
  const parts: Array<Record<string, unknown>> = [];
  for (const image of images.slice(0, 4)) {
    if (typeof image !== "string") continue;
    const parsed = parseImage(image);
    if (parsed) parts.push(parsed);
  }
  parts.push({ text });
  return [{ role: "user", parts }];
}

async function completion(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const apiKey = Bun.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return json(
      {
        error:
          "Missing Gemini API key. Add GOOGLE_GENERATIVE_AI_API_KEY to realtime-worker-api/.dev.vars.",
      },
      503,
    );
  }

  let body: CompletionBody;
  try {
    body = (await request.json()) as CompletionBody;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const model = Bun.env.GEMINI_MODEL?.trim() || "gemini-flash-lite-latest";
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: geminiContents(body),
        generationConfig: { maxOutputTokens: 2048, temperature: 0.45 },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  const result = (await upstream.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (!upstream.ok) {
    return json(
      { error: result.error?.message || `Gemini returned ${upstream.status}` },
      502,
    );
  }
  const text =
    result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") || "";
  const payload = `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`;
  return new Response(payload, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

async function interviewContext(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const select = db.query(
    "SELECT interviewNotes, resumeText, resumeFileName, jobDescription, englishLevel, responseLength, naturalEnglish, updatedAt FROM user_interview_context WHERE userId = ?",
  );
  if (request.method === "GET") {
    const row = select.get(auth.user.id) as Record<string, unknown> | null;
    return json({
      context: row
        ? { ...row, naturalEnglish: Boolean(row.naturalEnglish) }
        : {
            interviewNotes: null,
            resumeText: null,
            resumeFileName: null,
            jobDescription: null,
            englishLevel: "C1",
            responseLength: "standard",
            naturalEnglish: true,
            updatedAt: null,
          },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const parsed = interviewContextPatchSchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.message }, 400);
  const existing = (select.get(auth.user.id) || {}) as Record<string, unknown>;
  const storedString = (key: string, fallback: string | null = null) =>
    typeof existing[key] === "string" ? (existing[key] as string) : fallback;
  const value: {
    interviewNotes: string | null;
    resumeText: string | null;
    resumeFileName: string | null;
    jobDescription: string | null;
    englishLevel: string | null;
    responseLength: string | null;
    naturalEnglish: boolean | null;
    updatedAt: number;
  } = {
    interviewNotes:
      parsed.data.interviewNotes !== undefined
        ? parsed.data.interviewNotes
        : storedString("interviewNotes"),
    resumeText:
      parsed.data.resumeText !== undefined
        ? parsed.data.resumeText
        : storedString("resumeText"),
    resumeFileName:
      parsed.data.resumeFileName !== undefined
        ? parsed.data.resumeFileName
        : storedString("resumeFileName"),
    jobDescription:
      parsed.data.jobDescription !== undefined
        ? parsed.data.jobDescription
        : storedString("jobDescription"),
    englishLevel:
      parsed.data.englishLevel !== undefined
        ? parsed.data.englishLevel
        : storedString("englishLevel", "C1"),
    responseLength:
      parsed.data.responseLength !== undefined
        ? parsed.data.responseLength
        : storedString("responseLength", "standard"),
    naturalEnglish:
      parsed.data.naturalEnglish !== undefined
        ? parsed.data.naturalEnglish
        : existing.naturalEnglish === undefined
          ? true
          : Boolean(existing.naturalEnglish),
    updatedAt: Date.now(),
  };
  db.query(`
    INSERT INTO user_interview_context
      (userId, interviewNotes, resumeText, resumeFileName, jobDescription,
       englishLevel, responseLength, naturalEnglish, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      interviewNotes=excluded.interviewNotes,
      resumeText=excluded.resumeText,
      resumeFileName=excluded.resumeFileName,
      jobDescription=excluded.jobDescription,
      englishLevel=excluded.englishLevel,
      responseLength=excluded.responseLength,
      naturalEnglish=excluded.naturalEnglish,
      updatedAt=excluded.updatedAt
  `).run(
    auth.user.id,
    value.interviewNotes,
    value.resumeText,
    value.resumeFileName,
    value.jobDescription,
    value.englishLevel,
    value.responseLength,
    value.naturalEnglish ? 1 : 0,
    value.updatedAt,
  );
  return json({ ok: true, context: value });
}

async function notes(request: Request, url: URL) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  if (request.method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("limit")) || 20),
    );
    const offset = (page - 1) * limit;
    const rows = db
      .query(
        "SELECT id, userId, body AS content, tag, workspaceId, createdAt FROM saved_note WHERE userId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?",
      )
      .all(auth.user.id, limit, offset);
    const count = db
      .query("SELECT COUNT(*) AS total FROM saved_note WHERE userId = ?")
      .get(auth.user.id) as { total: number };
    return json({
      notes: rows,
      pagination: {
        page,
        limit,
        total: count.total,
        totalPages: Math.ceil(count.total / limit),
      },
    });
  }
  const body = (await request.json()) as { content?: string; tag?: string };
  const content = body.content?.trim();
  if (!content) return json({ error: "content is required" }, 400);
  const note = {
    id: crypto.randomUUID(),
    userId: auth.user.id,
    content: content.slice(0, 50_000),
    tag: (body.tag?.trim() || "Copilot").slice(0, 100),
    createdAt: Date.now(),
  };
  db.query(
    "INSERT INTO saved_note (id, userId, body, tag, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run(note.id, note.userId, note.content, note.tag, note.createdAt);
  return json({ note }, 201);
}

async function removeNote(request: Request, noteId: string) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  db.query("DELETE FROM saved_note WHERE id = ? AND userId = ?").run(
    noteId,
    auth.user.id,
  );
  return json({ success: true });
}

async function exportNotes(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const body = (await request.json()) as {
    format?: "markdown" | "pdf";
    noteIds?: string[];
  };
  const rows = db
    .query(
      "SELECT id, body AS content, tag, createdAt FROM saved_note WHERE userId = ? ORDER BY createdAt DESC",
    )
    .all(auth.user.id) as Array<{
    id: string;
    content: string;
    tag: string;
    createdAt: number;
  }>;
  const selected = body.noteIds?.length
    ? rows.filter((row) => body.noteIds?.includes(row.id))
    : rows;
  const markdown = selected
    .map(
      (row) =>
        `## ${row.tag} — ${new Date(row.createdAt).toLocaleString()}\n\n${row.content}`,
    )
    .join("\n\n---\n\n");
  if (body.format !== "pdf") {
    return new Response(markdown, { headers: { "Content-Type": "text/markdown" } });
  }
  const escaped = markdown
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Interview notes</title><style>body{font:16px/1.55 system-ui;max-width:800px;margin:40px auto;white-space:pre-wrap}</style>${escaped}`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/api/health") {
    return json({ ok: true, runtime: "bun-sqlite" });
  }
  if (path.startsWith("/api/auth")) return localAuth.handler(request);
  if (path === "/api/interview-context" && ["GET", "PATCH"].includes(request.method)) {
    return interviewContext(request);
  }
  if (path === "/api/notes" && ["GET", "POST"].includes(request.method)) {
    return notes(request, url);
  }
  const noteMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
  if (noteMatch && request.method === "DELETE") {
    return removeNote(request, decodeURIComponent(noteMatch[1]));
  }
  if (path === "/api/export" && request.method === "POST") {
    return exportNotes(request);
  }
  if (path === "/api/completion" && request.method === "POST") {
    return completion(request);
  }
  if (
    (path === "/api/deepgram" || path === "/api/deepgram/ask") &&
    ["GET", "POST"].includes(request.method)
  ) {
    const auth = await requireUser(request);
    if ("response" in auth) return auth.response;
    const key = Bun.env.DEEPGRAM_API_KEY?.trim();
    return key
      ? json({ key })
      : json(
          {
            error:
              "Missing Deepgram API key. Add DEEPGRAM_API_KEY to realtime-worker-api/.dev.vars.",
          },
          503,
        );
  }
  if (path === "/api/sessions/start" && request.method === "POST") {
    const auth = await requireUser(request);
    if ("response" in auth) return auth.response;
    return json({ sessionId: crypto.randomUUID(), startedAt: new Date().toISOString() });
  }
  if (
    ["/api/sessions/end", "/api/sessions/end-all", "/api/events/track"].includes(path) &&
    request.method === "POST"
  ) {
    const auth = await requireUser(request);
    if ("response" in auth) return auth.response;
    return json(path.endsWith("end-all") ? { endedCount: 0 } : { ok: true });
  }
  if (path === "/api/announcements/active" && request.method === "GET") {
    return json({ announcements: [] });
  }
  if (path === "/api/support/messages" && request.method === "GET") {
    return json({ threads: [], total: 0 });
  }
  if (path === "/api/usage/me" && request.method === "GET") {
    return json({ totals: {}, byAction: [], timeseries: [] });
  }
  if (
    (/^\/api\/announcements\/[^/]+\/(?:dismiss|ack)$/.test(path) ||
      path === "/api/support/messages/read") &&
    request.method === "POST"
  ) {
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    try {
      return withCors(await route(request), request);
    } catch (error) {
      console.error("[local-api]", error);
      return withCors(
        json(
          { error: error instanceof Error ? error.message : "Internal error" },
          500,
        ),
        request,
      );
    }
  },
});

console.log(`Local API listening on ${server.url}`);
console.log(`SQLite database: ${dbPath}`);
