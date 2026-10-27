const json = (body, status = 200, origin = "*") => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,PUT,OPTIONS", "cache-control": "no-store" } });

function originHeader(request, env) {
  const requestOrigin = request.headers.get("Origin") || "*";
  const allowed = env.ALLOWED_ORIGIN || "*";
  return allowed === "*" ? "*" : requestOrigin === allowed ? allowed : allowed;
}
async function sha256(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function validIdentifier(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{8,180}$/.test(value); }
function validBlob(value) { return typeof value === "string" && value.length > 20 && value.length < 5_000_000; }

export default {
  async fetch(request, env) {
    const origin = originHeader(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,PUT,OPTIONS", "access-control-max-age": "86400" } });
    const url = new URL(request.url);
    if (url.pathname !== "/api/sync") return json({ error: "Not found" }, 404, origin);
    try {
      if (request.method === "GET") {
        const workspaceId = url.searchParams.get("workspaceId"); const token = url.searchParams.get("token");
        if (!validIdentifier(workspaceId) || !validIdentifier(token)) return json({ error: "Invalid credentials" }, 400, origin);
        const row = await env.DB.prepare("SELECT workspace_id, token_hash, blob, version, updated_at FROM workspaces WHERE workspace_id = ?1").bind(workspaceId).first();
        if (!row) return json({ error: "Workspace not found" }, 404, origin);
        if (row.token_hash !== await sha256(token)) return json({ error: "Unauthorized" }, 401, origin);
        return json({ workspaceId: row.workspace_id, blob: row.blob, version: row.version, updatedAt: row.updated_at }, 200, origin);
      }
      if (request.method === "PUT") {
        const body = await request.json(); const { workspaceId, token, blob, expectedVersion = 0 } = body || {};
        if (!validIdentifier(workspaceId) || !validIdentifier(token) || !validBlob(blob)) return json({ error: "Invalid payload" }, 400, origin);
        const tokenHash = await sha256(token); const existing = await env.DB.prepare("SELECT token_hash, blob, version, updated_at FROM workspaces WHERE workspace_id = ?1").bind(workspaceId).first();
        if (!existing) { const now = new Date().toISOString(); await env.DB.prepare("INSERT INTO workspaces (workspace_id, token_hash, blob, version, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)").bind(workspaceId, tokenHash, blob, now).run(); return json({ workspaceId, version: 1 }, 200, origin); }
        if (existing.token_hash !== tokenHash) return json({ error: "Unauthorized" }, 401, origin);
        if (Number(expectedVersion) !== Number(existing.version)) return json({ error: "Conflict", blob: existing.blob, version: existing.version }, 409, origin);
        const nextVersion = Number(existing.version) + 1; const now = new Date().toISOString(); await env.DB.prepare("UPDATE workspaces SET blob = ?1, version = ?2, updated_at = ?3 WHERE workspace_id = ?4").bind(blob, nextVersion, now, workspaceId).run(); return json({ workspaceId, version: nextVersion }, 200, origin);
      }
      return json({ error: "Method not allowed" }, 405, origin);
    } catch (error) { console.error(error); return json({ error: "Server error" }, 500, origin); }
  }
};
