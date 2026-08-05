CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT UNIQUE NOT NULL,
  password_hash        TEXT NOT NULL,
  is_admin             BOOLEAN DEFAULT FALSE NOT NULL,
  is_disabled          BOOLEAN DEFAULT FALSE NOT NULL,
  reset_token          TEXT,
  reset_token_expires  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Migrate existing deployments that predate these columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin            BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled         BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS projects (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name              TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_content      TEXT NOT NULL,
  original_content  TEXT,
  is_archived       BOOLEAN DEFAULT FALSE NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS original_content TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE NOT NULL;

CREATE TABLE IF NOT EXISTS project_versions (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  version_num  INTEGER NOT NULL,
  file_content TEXT NOT NULL,
  saved_at     TIMESTAMPTZ DEFAULT NOW()
);
