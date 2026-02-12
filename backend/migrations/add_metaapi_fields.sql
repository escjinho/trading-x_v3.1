-- MetaAPI 유저별 계정 관리 필드 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS metaapi_account_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS metaapi_status VARCHAR(20) DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS metaapi_deployed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS metaapi_last_active TIMESTAMPTZ;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_metaapi_status ON users(metaapi_status);
CREATE INDEX IF NOT EXISTS idx_users_metaapi_account_id ON users(metaapi_account_id);
