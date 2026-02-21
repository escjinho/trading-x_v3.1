-- 등급 설정 테이블 생성
CREATE TABLE IF NOT EXISTS grade_configs (
    id SERIAL PRIMARY KEY,
    grade_name VARCHAR(50) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    min_lots FLOAT DEFAULT 0.0,
    self_referral FLOAT DEFAULT 0.0,
    benefit_desc VARCHAR(200),
    badge_color VARCHAR(20) DEFAULT '#888',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 기본 등급 데이터 삽입 (어드민에서 수정 가능)
INSERT INTO grade_configs (grade_name, sort_order, min_lots, self_referral, benefit_desc, badge_color) VALUES
('Standard', 0, 0, 0, '기본 혜택', '#9e9e9e'),
('Pro', 1, 100, 1.0, '셀프 리퍼럴 $1/lot', '#00d4ff'),
('VIP', 2, 300, 2.0, '셀프 리퍼럴 $2/lot', '#ffd600')
ON CONFLICT DO NOTHING;
