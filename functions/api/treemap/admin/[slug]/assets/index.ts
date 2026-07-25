import {
  FunctionContext,
  error,
  isAdmin,
  isSameOrigin,
  json,
  methodNotAllowed,
} from "../../../../../_shared/treemap";

const ALLOWED_IMAGES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "POST") return methodNotAllowed(["POST"]);
  if (!(await isAdmin(context.request, context.env))) {
    return error("Unauthorized", 401);
  }
  if (!isSameOrigin(context.request)) return error("Forbidden", 403);

  const slug = String(context.params.slug || "");
  const map = await context.env.TREEMAP_DB.prepare(
    "SELECT id FROM mindmaps WHERE slug = ?1 LIMIT 1",
  )
    .bind(slug)
    .first<{ id: string }>();
  if (!map) return error("Map not found", 404);

  const form = await context.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("画像を選択してください。");
  const extension = ALLOWED_IMAGES[file.type];
  if (!extension) return error("JPEG・PNG・WebPだけ利用できます。", 415);
  if (file.size > 5 * 1024 * 1024) {
    return error("画像は5MB以下にしてください。", 413);
  }

  const id = crypto.randomUUID();
  const objectKey = `treemaps/${map.id}/${id}.${extension}`;
  await context.env.TREEMAP_ASSETS.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { mapId: map.id, assetId: id },
  });
  try {
    await context.env.TREEMAP_DB.prepare(
      `INSERT INTO mindmap_assets
        (id, mindmap_id, object_key, mime_type, byte_size)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(id, map.id, objectKey, file.type, file.size)
      .run();
  } catch (caught) {
    await context.env.TREEMAP_ASSETS.delete(objectKey);
    throw caught;
  }

  return json(
    {
      id,
      url: `/api/treemap/assets/${id}`,
    },
    201,
  );
}
