/* ========================================
   Chart Gauge Panel Module
   Chart 탭 게이지 렌더링 및 애니메이션
   ======================================== */

const ChartGaugePanel = {
    // 내부 상태
    animationFrameId: null,

    /**
     * 차트 게이지 패널 초기화
     */
    init() {
        this.initChartGaugeArcs();
        this.startAnimation();
        console.log('[ChartGaugePanel] Initialized');
    },

    /**
     * 차트 게이지 Arc 경로 생성
     */
    initChartGaugeArcs() {
        const centerX = 140, centerY = 100, radius = 70;
        const sellArc = this.createArcPath(centerX, centerY, radius, Math.PI, Math.PI * 0.5);
        const buyArc = this.createArcPath(centerX, centerY, radius, Math.PI * 0.5, 0);

        const chartSellArc = document.getElementById('chartSellArc');
        const chartBuyArc = document.getElementById('chartBuyArc');

        if (chartSellArc) chartSellArc.setAttribute('d', sellArc);
        if (chartBuyArc) chartBuyArc.setAttribute('d', buyArc);
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
     * 차트 게이지 애니메이션 업데이트
     */
    updateChartGauge() {
        // 스프링-댐핑 애니메이션
        const diff = chartTargetScore - chartDisplayScore;
        if (Math.abs(diff) < 0.3 && Math.abs(chartVelocity) < 0.1) {
            chartDisplayScore = chartTargetScore;
            chartVelocity = 0;
        } else {
            const springK = 0.1;
            const dampingK = 0.25;
            const springForce = diff * springK;
            chartVelocity = chartVelocity * (1 - dampingK) + springForce;
            chartDisplayScore = Math.max(0, Math.min(100, chartDisplayScore + chartVelocity));
        }

        // 바늘 위치 계산
        const angleRad = Math.PI - (chartDisplayScore / 100) * Math.PI;
        const needleLength = 55;
        const cx = 140, cy = 100;
        const nx = cx + Math.cos(angleRad) * needleLength;
        const ny = cy - Math.sin(angleRad) * needleLength;

        // 바늘 업데이트
        const needle = document.getElementById('chartGaugeNeedle');
        const shadow = document.getElementById('chartNeedleShadow');
        if (needle) {
            needle.setAttribute('x2', nx);
            needle.setAttribute('y2', ny);
        }
        if (shadow) {
            shadow.setAttribute('x2', nx + 1);
            shadow.setAttribute('y2', ny + 1);
        }

        // 상태 텍스트 업데이트
        this.updateStatusText(chartDisplayScore);

        // 다음 프레임 요청
        this.animationFrameId = requestAnimationFrame(() => this.updateChartGauge());
    },

    /**
     * 차트 게이지 상태 텍스트 업데이트
     */
    updateStatusText(score) {
        const statusEl = document.getElementById('chartGaugeStatus');
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
        this.updateChartGauge();
    },

    /**
     * 외부에서 데이터 업데이트
     */
    update(data) {
        // chartTargetScore가 업데이트되면 자동으로 애니메이션이 반영됨
        // 특별히 할 작업 없음 (전역 변수 chartTargetScore를 사용하므로)
    },

    /**
     * 패널 정리
     */
    destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        console.log('[ChartGaugePanel] Destroyed');
    }
};
