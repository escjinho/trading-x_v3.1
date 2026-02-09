/* ========================================
   Gauge Panel Module
   Trade 탭 게이지 렌더링 및 애니메이션
   ======================================== */

const GaugePanel = {
    // 내부 상태
    animationFrameId: null,

    /**
     * 게이지 패널 초기화
     */
    init() {
        this.initGaugeArcs();
        this.startAnimation();
        console.log('[GaugePanel] Initialized');
    },

    /**
     * 게이지 Arc 경로 생성
     */
    initGaugeArcs() {
        const centerX = 150, centerY = 110, radius = 80;
        const sellArc = this.createArcPath(centerX, centerY, radius, Math.PI, Math.PI * 0.5);
        const buyArc = this.createArcPath(centerX, centerY, radius, Math.PI * 0.5, 0);

        const sellArcEl = document.getElementById('sellArc');
        const buyArcEl = document.getElementById('buyArc');

        if (sellArcEl) sellArcEl.setAttribute('d', sellArc);
        if (buyArcEl) buyArcEl.setAttribute('d', buyArc);
    },

    /**
     * SVG Arc 경로 생성
     */
    createArcPath(centerX, centerY, radius, startAngle, endAngle) {
        const startX = centerX + Math.cos(startAngle) * radius;
        const startY = centerY - Math.sin(startAngle) * radius;
        const endX = centerX + Math.cos(endAngle) * radius;
        const endY = centerY - Math.sin(endAngle) * radius;
        const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
        return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
    },

    /**
     * 외부에서 인디케이터 데이터로 게이지 점수 업데이트
     * ★★★ 백엔드 base_score를 그대로 사용 (connection.js에서 설정) ★★★
     * - 프론트엔드에서 재계산하지 않음
     * - connection.js에서 baseScore, targetScore, chartTargetScore 설정됨
     */
    updateGauge(buyCount, sellCount, neutralCount) {
        // 백엔드에서 계산된 base_score를 connection.js에서 직접 설정하므로
        // 여기서는 별도의 계산 없이 패스 (호환성 유지를 위해 함수는 유지)
        // baseScore, targetScore, chartTargetScore는 connection.js에서 관리됨
    },

    /**
     * 게이지 애니메이션 루프 (requestAnimationFrame)
     */
    _animate() {
        // 스프링-댐핑 애니메이션
        const diff = targetScore - displayScore;
        if (Math.abs(diff) < 0.3 && Math.abs(velocity) < 0.1) {
            displayScore = targetScore;
            velocity = 0;
        } else {
            const springK = 0.06;
            const dampingK = 0.15;
            const springForce = diff * springK;
            velocity = velocity * (1 - dampingK) + springForce;
            displayScore = Math.max(0, Math.min(100, displayScore + velocity));
        }

        // 바늘 위치 계산
        const angleRad = Math.PI - (displayScore / 100) * Math.PI;
        const needleLength = 60;
        const cx = 150, cy = 110;
        const nx = cx + Math.cos(angleRad) * needleLength;
        const ny = cy - Math.sin(angleRad) * needleLength;

        // 바늘 업데이트
        const needle = document.getElementById('gaugeNeedle');
        const shadow = document.getElementById('needleShadow');
        if (needle) {
            needle.setAttribute('x2', nx);
            needle.setAttribute('y2', ny);
        }
        if (shadow) {
            shadow.setAttribute('x2', nx + 1);
            shadow.setAttribute('y2', ny + 1);
        }

        // 상태 텍스트 업데이트
        this.updateStatusText(displayScore);

        // 다음 프레임 요청
        this.animationFrameId = requestAnimationFrame(() => this._animate());
    },

    /**
     * 게이지 상태 텍스트 업데이트
     */
    updateStatusText(score) {
        const statusEl = document.getElementById('gaugeStatusText');
        if (!statusEl) return;

        let statusText = 'Neutral';
        let statusColor = '#646473';

        if (score < 20) {
            statusText = 'Strong Sell';
            statusColor = '#dc3246';
        } else if (score < 40) {
            statusText = 'Sell';
            statusColor = '#dc3246';
        } else if (score < 60) {
            statusText = 'Neutral';
            statusColor = '#646473';
        } else if (score < 80) {
            statusText = 'Buy';
            statusColor = '#00b450';
        } else {
            statusText = 'Strong Buy';
            statusColor = '#00b450';
        }

        statusEl.textContent = statusText;
        statusEl.style.color = statusColor;
        statusEl.style.textShadow = '0 0 15px ' + statusColor;
    },

    /**
     * 애니메이션 시작
     */
    startAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this._animate();
    },

    /**
     * 패널 정리
     */
    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        console.log('[GaugePanel] Destroyed');
    }
};
