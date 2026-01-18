/* ========================================
   Random Walk Panel Module
   게이지 랜덤 워크 계산
   ======================================== */

const RandomWalkPanel = {
    // 내부 상태
    intervalId: null,

    /**
     * 랜덤 워크 패널 초기화
     */
    init() {
        this.startRandomWalk();
        console.log('[RandomWalkPanel] Initialized');
    },

    /**
     * 랜덤 워크 계산
     */
    calcRandomWalk() {
        const currentDiff = baseScore - targetScore;
        const pullStrength = 0.4;
        const noiseScale = 30.0;

        // baseScore로 당기는 힘
        const pullToBase = currentDiff * pullStrength;

        // 일반 노이즈
        const noise = (Math.random() - 0.5) * noiseScale;

        // 가끔 큰 노이즈 (15% 확률)
        let extraNoise = 0;
        if (Math.random() < 0.15) {
            extraNoise = (Math.random() - 0.5) * 20.0;
        }

        // targetScore 업데이트
        targetScore = targetScore + pullToBase + noise + extraNoise;
        targetScore = Math.max(5, Math.min(95, targetScore));
    },

    /**
     * 랜덤 워크 시작
     */
    startRandomWalk() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        // 2~3초마다 랜덤하게 실행
        const runNext = () => {
            this.calcRandomWalk();
            const delay = 2000 + Math.random() * 1000; // 2000~3000ms
            this.intervalId = setTimeout(runNext, delay);
        };

        runNext();
    },

    /**
     * 외부에서 데이터 업데이트
     */
    update(data) {
        // 특별히 할 작업 없음
    },

    /**
     * 패널 정리
     */
    destroy() {
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }
        console.log('[RandomWalkPanel] Destroyed');
    }
};
