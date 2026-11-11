CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  continues INTEGER NOT NULL,
  start_stage INTEGER NOT NULL,
  cleared INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  client TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_ranking ON scores(start_stage,score DESC,continues ASC,created_at ASC,id ASC);
CREATE INDEX IF NOT EXISTS scores_throttle ON scores(client,created_at);
