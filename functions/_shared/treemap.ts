const SESSION_COOKIE = "treemap_session";
const SESSION_SECONDS = 60 * 60 * 12;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 500;

export type Env = {
  TREEMAP_DB: D1Database;
  TREEMAP_ASSETS: R2Bucket;
  AI: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  TREEMAP_ADMIN_PASSWORD_HASH: string;
  TREEMAP_SESSION_SECRET: string;
};

export type FunctionContext = {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
};

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}

export function methodNotAllowed(allowed: string[]) {
  return error("Method not allowed", 405);
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

export async function verifyPassword(env: Env, password: string) {
  if (!password || !env.TREEMAP_ADMIN_PASSWORD_HASH) return false;
  const [scheme, iterationText, saltText, expectedText] =
    env.TREEMAP_ADMIN_PASSWORD_HASH.trim().split("$");
  const iterations = Number(iterationText);
  if (
    scheme !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !expectedText
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64UrlToBytes(saltText),
        iterations,
      },
      key,
      256,
    ),
  );
  return timingSafeEqual(derived, base64UrlToBytes(expectedText));
}

export async function createSessionCookie(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: "owner",
        iat: now,
        exp: now + SESSION_SECONDS,
        nonce: crypto.randomUUID(),
      }),
    ),
  );
  const signature = bytesToBase64Url(
    await hmac(env.TREEMAP_SESSION_SECRET, payload),
  );
  return `${SESSION_COOKIE}=${payload}.${signature}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export async function isAdmin(request: Request, env: Env) {
  if (!env.TREEMAP_SESSION_SECRET) return false;
  const token = readCookie(request, SESSION_COOKIE);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  try {
    const expected = await hmac(env.TREEMAP_SESSION_SECRET, payload);
    if (!timingSafeEqual(expected, base64UrlToBytes(signature))) return false;
    const decoded = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    ) as { sub?: string; exp?: number };
    return (
      decoded.sub === "owner" &&
      typeof decoded.exp === "number" &&
      decoded.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function validateDocument(input: unknown) {
  const encoded = JSON.stringify(input);
  if (encoded.length > MAX_DOCUMENT_BYTES) {
    throw new Error("マップのデータ量が上限を超えています。");
  }
  if (!input || typeof input !== "object") {
    throw new Error("マップの形式が正しくありません。");
  }

  const source = input as {
    rootId?: unknown;
    nodes?: unknown;
  };
  if (
    typeof source.rootId !== "string" ||
    !source.rootId ||
    !Array.isArray(source.nodes) ||
    source.nodes.length < 1 ||
    source.nodes.length > MAX_NODES
  ) {
    throw new Error("ルートまたはノード数が正しくありません。");
  }

  const ids = new Set<string>();
  const nodes = source.nodes.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`ノード${index + 1}の形式が正しくありません。`);
    }
    const node = item as {
      id?: unknown;
      position?: { x?: unknown; y?: unknown };
      data?: Record<string, unknown>;
    };
    if (
      typeof node.id !== "string" ||
      !node.id ||
      node.id.length > 100 ||
      ids.has(node.id)
    ) {
      throw new Error("ノードIDが正しくありません。");
    }
    ids.add(node.id);
    if (
      !node.position ||
      typeof node.position.x !== "number" ||
      !Number.isFinite(node.position.x) ||
      typeof node.position.y !== "number" ||
      !Number.isFinite(node.position.y)
    ) {
      throw new Error("ノード位置が正しくありません。");
    }
    const title =
      typeof node.data?.title === "string" ? node.data.title.trim() : "";
    const note = typeof node.data?.note === "string" ? node.data.note : "";
    const parentId =
      typeof node.data?.parentId === "string" && node.data.parentId
        ? node.data.parentId
        : null;
    if (!title || title.length > 120 || note.length > 500) {
      throw new Error("タイトルまたはメモが上限を超えています。");
    }
    return {
      id: node.id,
      position: { x: node.position.x, y: node.position.y },
      data: {
        title,
        note,
        parentId,
        collapsed: Boolean(node.data?.collapsed),
        ...(typeof node.data?.imageId === "string" &&
        node.data.imageId.length <= 100
          ? { imageId: node.data.imageId }
          : {}),
        ...(typeof node.data?.imageUrl === "string" &&
        node.data.imageUrl.startsWith("/api/treemap/assets/")
          ? { imageUrl: node.data.imageUrl }
          : {}),
        ...(safeHttpUrl(node.data?.href)
          ? { href: safeHttpUrl(node.data?.href) }
          : {}),
      },
    };
  });

  if (!ids.has(source.rootId)) throw new Error("ルートが存在しません。");
  for (const node of nodes) {
    if (node.id === source.rootId && node.data.parentId !== null) {
      throw new Error("ルートには親を設定できません。");
    }
    if (
      node.id !== source.rootId &&
      (!node.data.parentId || !ids.has(node.data.parentId))
    ) {
      throw new Error("親ノードが存在しません。");
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    let cursor: string | null = node.id;
    const seen = new Set<string>();
    while (cursor) {
      if (seen.has(cursor)) throw new Error("枝が循環しています。");
      seen.add(cursor);
      cursor = byId.get(cursor)?.data.parentId || null;
    }
  }

  return { rootId: source.rootId, nodes };
}

export type MindmapRow = {
  id: string;
  slug: string;
  title: string;
  document_json: string;
  version: number;
  updated_at: string;
};

export function mapRow(row: MindmapRow) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    version: Number(row.version),
    updatedAt: row.updated_at,
    document: JSON.parse(row.document_json),
  };
}

export async function readJsonBody(request: Request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_DOCUMENT_BYTES + 32_768) {
    throw new Error("リクエストが大きすぎます。");
  }
  return request.json();
}

export type ValidatedOutline = {
  title: string;
  children: ValidatedOutline[];
};

export function validateOutline(input: unknown) {
  let count = 0;

  const walk = (value: unknown, depth: number): ValidatedOutline => {
    if (!value || typeof value !== "object" || depth > 8) {
      throw new Error("AIが作った階層を読み取れませんでした。");
    }
    const source = value as { title?: unknown; children?: unknown };
    const title =
      typeof source.title === "string" ? source.title.trim() : "";
    if (!title || title.length > 120) {
      throw new Error("AIが作った項目名が正しくありません。");
    }
    const children = Array.isArray(source.children) ? source.children : [];
    count += 1;
    if (count > 150) {
      throw new Error("AIが作った項目数が多すぎます。");
    }
    return {
      title,
      children: children.map((child) => walk(child, depth + 1)),
    };
  };

  return walk(input, 0);
}

export function parseJsonObject(value: string) {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AIの返答を読み取れませんでした。");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}
