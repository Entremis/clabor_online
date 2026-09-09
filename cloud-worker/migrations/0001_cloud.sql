CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 salt TEXT NOT NULL, iterations INTEGER NOT NULL, created_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0, last_operation TEXT
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE records (
 owner_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL,
 value TEXT, revision INTEGER NOT NULL, PRIMARY KEY(owner_id,key)
);
CREATE INDEX record_changes ON records(owner_id,revision,key);
CREATE TABLE mutations (
 owner_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL,
 revision INTEGER NOT NULL, payload_hash TEXT NOT NULL, PRIMARY KEY(owner_id,id)
);
CREATE TABLE auth_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
CREATE INDEX auth_limit_expiry ON auth_limits(reset_at);
