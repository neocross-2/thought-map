import {
  FunctionContext,
  error,
  isAdmin,
  isSameOrigin,
  json,
  mapRow,
  MindmapRow,
  methodNotAllowed,
  readJsonBody,
  validateDocument,
} from "../../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (!["GET", "PUT"].includes(context.request.method)) {
    return methodNotAllowed(["GET", "PUT"]);
  }
  if (!(await isAdmin(context.request, context.env))) {
    return error("Unauthorized", 401);
  }

  const slug = String(context.params.slug || "");
  if (context.request.method === "GET") {
    const row = await context.env.TREEMAP_DB.prepare(
      `SELECT id, slug, title, document_json, version, updated_at
         FROM mindmaps WHERE slug = ?1 LIMIT 1`,
    )
      .bind(slug)
      .first<MindmapRow>();
    return row ? json(mapRow(row)) : error("Map not found", 404);
  }

  if (!isSameOrigin(context.request)) return error("Forbidden", 403);
  try {
    const body = (await readJsonBody(context.request)) as {
      title?: unknown;
      version?: unknown;
      document?: unknown;
    };
    const title =
      typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    const version = Number(body.version);
    if (!title || !Number.isInteger(version) || version < 1) {
      return error("更新情報が正しくありません。");
    }
    const document = validateDocument(body.document);
    const result = await context.env.TREEMAP_DB.prepare(
      `UPDATE mindmaps
          SET title = ?1,
              document_json = ?2,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?3 AND version = ?4`,
    )
      .bind(title, JSON.stringify(document), slug, version)
      .run();
    if (!result.meta?.changes) {
      return error("別の画面で更新されています。再読み込みしてください。", 409);
    }
    const row = await context.env.TREEMAP_DB.prepare(
      `SELECT id, slug, title, document_json, version, updated_at
         FROM mindmaps WHERE slug = ?1 LIMIT 1`,
    )
      .bind(slug)
      .first<MindmapRow>();
    return row ? json(mapRow(row)) : error("Map not found", 404);
  } catch (caught) {
    return error(
      caught instanceof Error ? caught.message : "保存できませんでした。",
      400,
    );
  }
}
