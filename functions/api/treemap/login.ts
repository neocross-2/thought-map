import {
  FunctionContext,
  createSessionCookie,
  error,
  isSameOrigin,
  json,
  methodNotAllowed,
  readJsonBody,
  verifyPassword,
} from "../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "POST") return methodNotAllowed(["POST"]);
  if (!isSameOrigin(context.request)) return error("Forbidden", 403);

  try {
    const body = (await readJsonBody(context.request)) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (!(await verifyPassword(context.env, password))) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return error("パスワードが違います。", 401);
    }
    return json(
      { ok: true },
      200,
      { "Set-Cookie": await createSessionCookie(context.env) },
    );
  } catch (caught) {
    console.error(
      "treemap login failed",
      caught instanceof Error ? `${caught.name}: ${caught.message}` : "unknown",
    );
    return error("ログイン情報を確認できません。", 400);
  }
}
