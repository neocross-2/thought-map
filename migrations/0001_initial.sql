PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mindmaps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  document_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mindmap_assets (
  id TEXT PRIMARY KEY,
  mindmap_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mindmap_id) REFERENCES mindmaps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mindmap_assets_map
  ON mindmap_assets(mindmap_id);

INSERT OR IGNORE INTO mindmaps
  (id, slug, title, document_json, version, is_public)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    'default',
    '思考マップ',
    '{"rootId":"root","nodes":[{"id":"root","position":{"x":80,"y":220},"data":{"title":"思考マップ","note":"画像と枝で、考えを育てる。","parentId":null,"collapsed":false}}]}',
    1,
    1
  );
