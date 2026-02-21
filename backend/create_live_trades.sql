CREATE TABLE IF NOT EXISTS live_trades (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    symbol VARCHAR(50) NOT NULL,
    trade_type VARCHAR(10) NOT NULL,
    volume FLOAT NOT NULL,
    position_id VARCHAR(100),
    entry_price FLOAT DEFAULT 0.0,
    exit_price FLOAT,
    profit FLOAT DEFAULT 0.0,
    is_closed BOOLEAN DEFAULT FALSE,
    magic INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_live_trades_user_id ON live_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_live_trades_position_id ON live_trades(position_id);
