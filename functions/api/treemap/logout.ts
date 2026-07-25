import {
  FunctionContext,
  clearSessionCookie,
  error,
  isSameOrigin,
  json,
  methodNotAllowed,
} from "../../_shared/treemap";

export async function onRequest(context: FunctionContext) {
  if (context.request.method !== "POST") return methodNotAllowed(["POST"]);
  if (!isSameOrigin(context.request)) return error("Forbidden", 403);
  return json({ ok: true }, 200, {
    "Set-Cookie": clearSessionCookie(),
  });
}
