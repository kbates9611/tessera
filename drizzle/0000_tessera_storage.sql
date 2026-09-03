CREATE TABLE IF NOT EXISTS tessera_workspace_state (
  workspace_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  state_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tessera_workspace_uploads (
  object_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tessera_workspace_uploads_workspace_created_at_idx
  ON tessera_workspace_uploads (workspace_id, created_at);
