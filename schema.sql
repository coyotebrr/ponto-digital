CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    record_type VARCHAR(10) NOT NULL
        CHECK (record_type IN ('entrada', 'saida')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_records_user_date_idx
    ON time_records (user_id, recorded_at DESC);


/*Codigo testar

CREATE TABLE IF NOT EXISTS time_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id VARCHAR(30) NOT NULL REFERENCES users(user_id),
    record_type VARCHAR(10) NOT NULL
        CHECK (record_type IN ('entrada', 'saida')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS time_records_user_date_idx
    ON time_records (user_id, recorded_at DESC);

*/