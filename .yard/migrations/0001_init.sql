-- Hop schema: one table holding every short link, who made it, and how many
-- times it has been followed. Every statement is idempotent because migration
-- files are not transactional: a mid-file failure leaves earlier statements
-- applied, and the next deploy re-runs the whole file from the top.

-- code is the path after s/: lowercase letters, digits and dashes, either
-- generated or picked as an alias. It is the primary key, so no two links can
-- share one. owner_id is the X-Yard-User-Id of the person who made the link.
CREATE TABLE IF NOT EXISTS links (
  code       TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  clicks     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- "Your links, newest first" is the only listing query.
CREATE INDEX IF NOT EXISTS idx_links_owner ON links (owner_id, created_at DESC);
