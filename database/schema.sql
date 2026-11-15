-- NokosID schema. The API also creates these tables automatically.
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS otp_requests (
  id UUID PRIMARY KEY, phone VARCHAR(20) NOT NULL, otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS otp_phone_created_idx ON otp_requests(phone, created_at DESC);
CREATE TABLE IF NOT EXISTS wallets (
  user_id BIGINT PRIMARY KEY REFERENCES users(id), balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  entry_type VARCHAR(30) NOT NULL, amount BIGINT NOT NULL, reference_id TEXT NOT NULL,
  note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(entry_type, reference_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), service_id TEXT NOT NULL,
  service_name TEXT NOT NULL, provider_order_id TEXT, phone VARCHAR(30), price BIGINT NOT NULL,
  status VARCHAR(30) NOT NULL, sms TEXT, otp TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS deposits (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), amount BIGINT NOT NULL CHECK (amount > 0),
  note TEXT, status VARCHAR(20) NOT NULL DEFAULT 'pending', reviewed_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
);
