CREATE TABLE IF NOT EXISTS gallery_images (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  external_url TEXT,
  full_key TEXT,
  thumbnail_key TEXT,
  content_type TEXT NOT NULL DEFAULT 'image/webp',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS gallery_images_created_at
  ON gallery_images(created_at DESC);

CREATE TABLE IF NOT EXISTS gallery_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS image_tags (
  image_id TEXT NOT NULL REFERENCES gallery_images(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES gallery_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, tag_id)
);

CREATE INDEX IF NOT EXISTS image_tags_tag_id
  ON image_tags(tag_id, image_id);

CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  user_hash TEXT,
  ip_hash TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_at
  ON audit_log(at DESC);
