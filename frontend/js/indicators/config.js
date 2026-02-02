/* ========================================
   Indicator Configuration
   TradingView 기본값 기반 지표 설정
   ======================================== */

const IndicatorConfig = {
    // ========== 오버레이 지표 (메인 차트에 표시) ==========
    overlay: {
        sma: {
            id: 'sma',
            name: 'SMA',
            fullName: 'Simple Moving Average',
            type: 'overlay',
            enabled: false,
            params: {
                period: 20,
                source: 'close'
            },
            style: {
                color: '#2196F3',
                lineWidth: 2,
                lineStyle: 0  // 0: solid, 1: dotted, 2: dashed
            }
        },
        ema: {
            id: 'ema',
            name: 'EMA',
            fullName: 'Exponential Moving Average',
            type: 'overlay',
            enabled: false,
            params: {
                period: 20,
                source: 'close'
            },
            style: {
                color: '#FF9800',
                lineWidth: 2,
                lineStyle: 0
            }
        },
        wma: {
            id: 'wma',
            name: 'WMA',
            fullName: 'Weighted Moving Average',
            type: 'overlay',
            enabled: false,
            params: {
                period: 20,
                source: 'close'
            },
            style: {
                color: '#9C27B0',
                lineWidth: 2,
                lineStyle: 0
            }
        },
        lwma: {
            id: 'lwma',
            name: 'LWMA',
            fullName: 'Linear Weighted Moving Average',
            type: 'overlay',
            enabled: false,
            params: {
                period: 20,
                source: 'close'
            },
            style: {
                color: '#FFEB3B',
                lineWidth: 2,
                lineStyle: 0
            }
        },
        bb: {
            id: 'bb',
            name: 'BB',
            fullName: 'Bollinger Bands',
            type: 'overlay',
            enabled: true,  // 기본 활성화
            params: {
                period: 20,
                stdDev: 2,
                source: 'close'
            },
            style: {
                upperColor: '#2196F3',
                middleColor: '#2196F3',
                lowerColor: '#2196F3',
                lineWidth: 1,
                middleLineStyle: 2,  // dashed
                fillColor: 'rgba(33, 150, 243, 0.1)'
            }
        },
        psar: {
            id: 'psar',
            name: 'PSAR',
            fullName: 'Parabolic SAR',
            type: 'overlay',
            enabled: false,
            params: {
                start: 0.02,
                increment: 0.02,
                maximum: 0.2
            },
            style: {
                upColor: '#00E676',
                downColor: '#FF5252',
                size: 2
            }
        },
        ichimoku: {
            id: 'ichimoku',
            name: 'Ichimoku',
            fullName: 'Ichimoku Cloud',
            type: 'overlay',
            enabled: false,
            params: {
                conversionPeriod: 9,
                basePeriod: 26,
                spanPeriod: 52,
                displacement: 26
            },
            style: {
                conversionColor: '#2196F3',
                baseColor: '#F44336',
                spanAColor: '#4CAF50',
                spanBColor: '#FF9800',
                cloudUpColor: 'rgba(76, 175, 80, 0.2)',
                cloudDownColor: 'rgba(255, 152, 0, 0.2)',
                lineWidth: 1
            }
        },
        vwap: {
            id: 'vwap',
            name: 'VWAP',
            fullName: 'Volume Weighted Average Price',
            type: 'overlay',
            enabled: false,
            params: {
                anchorPeriod: 'session'  // session, week, month
            },
            style: {
                color: '#E91E63',
                lineWidth: 2,
                lineStyle: 0
            }
        }
    },

    // ========== 패널 지표 (별도 차트 패널에 표시) ==========
    panel: {
        rsi: {
            id: 'rsi',
            name: 'RSI',
            fullName: 'Relative Strength Index',
            type: 'panel',
            enabled: false,
            params: {
                period: 14,
                source: 'close',
                overbought: 70,
                oversold: 30
            },
            style: {
                lineColor: '#7B1FA2',
                lineWidth: 2,
                overboughtColor: 'rgba(255, 82, 82, 0.3)',
                oversoldColor: 'rgba(76, 175, 80, 0.3)',
                bandColor: 'rgba(255, 255, 255, 0.1)'
            },
            panelHeight: 100,
            minValue: 0,
            maxValue: 100
        },
        macd: {
            id: 'macd',
            name: 'MACD',
            fullName: 'Moving Average Convergence Divergence',
            type: 'panel',
            enabled: false,
            params: {
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9,
                source: 'close'
            },
            style: {
                macdColor: '#2196F3',
                signalColor: '#FF9800',
                histogramUpColor: '#26A69A',
                histogramDownColor: '#EF5350',
                lineWidth: 2
            },
            panelHeight: 100
        },
        stochastic: {
            id: 'stochastic',
            name: 'Stoch',
            fullName: 'Stochastic Oscillator',
            type: 'panel',
            enabled: false,
            params: {
                kPeriod: 14,
                dPeriod: 3,
                smooth: 3,
                overbought: 80,
                oversold: 20
            },
            style: {
                kColor: '#2196F3',
                dColor: '#FF9800',
                lineWidth: 2,
                overboughtColor: 'rgba(255, 82, 82, 0.3)',
                oversoldColor: 'rgba(76, 175, 80, 0.3)'
            },
            panelHeight: 100,
            minValue: 0,
            maxValue: 100
        },
        volume: {
            id: 'volume',
            name: 'Vol',
            fullName: 'Volume',
            type: 'panel',
            enabled: false,
            params: {
                maEnabled: true,
                maPeriod: 20
            },
            style: {
                upColor: 'rgba(38, 166, 154, 0.5)',
                downColor: 'rgba(239, 83, 80, 0.5)',
                maColor: '#FFEB3B',
                maLineWidth: 1
            },
            panelHeight: 80
        },
        atr: {
            id: 'atr',
            name: 'ATR',
            fullName: 'Average True Range',
            type: 'panel',
            enabled: false,
            params: {
                period: 14
            },
            style: {
                lineColor: '#26A69A',
                lineWidth: 2
            },
            panelHeight: 80
        },
        cci: {
            id: 'cci',
            name: 'CCI',
            fullName: 'Commodity Channel Index',
            type: 'panel',
            enabled: false,
            params: {
                period: 20,
                overbought: 100,
                oversold: -100
            },
            style: {
                lineColor: '#00BCD4',
                lineWidth: 2,
                overboughtColor: 'rgba(255, 82, 82, 0.3)',
                oversoldColor: 'rgba(76, 175, 80, 0.3)'
            },
            panelHeight: 100
        },
        williamsR: {
            id: 'williamsR',
            name: '%R',
            fullName: 'Williams %R',
            type: 'panel',
            enabled: false,
            params: {
                period: 14,
                overbought: -20,
                oversold: -80
            },
            style: {
                lineColor: '#FF5722',
                lineWidth: 2,
                overboughtColor: 'rgba(255, 82, 82, 0.3)',
                oversoldColor: 'rgba(76, 175, 80, 0.3)'
            },
            panelHeight: 100,
            minValue: -100,
            maxValue: 0
        }
    },

    // ========== 레이아웃 설정 ==========
    // ========== 레이아웃 설정 (제로마켓 스타일) ==========
    layout: {
        totalHeight: 500,           // 차트 전체 고정 높이 (모바일)
        totalHeightDesktop: 720,    // PC 전체 고정 높이
        mainChartMinHeight: 200,    // 메인 차트 최소 높이
        panelMinHeight: 60,         // 패널 최소 높이
        panelMaxCount: 3,           // 최대 패널 개수
        panelGap: 0,                // 패널 간격 (연속된 차트 스타일)
        panelHeight: 80,            // 기본 패널 높이
        lastPanelHeight: 100        // 마지막 패널 높이 (시간축 포함)
    },

    // ========== ID 별칭 매핑 ==========
    aliases: {
        'stoch': 'stochastic',
        'williams': 'williamsR'
    },

    // 역방향 별칭 (정규화된 ID → 모달 ID)
    reverseAliases: {
        'stochastic': 'stoch',
        'williamsR': 'williams'
    },

    /**
     * 모달 ID 가져오기 (정규화된 ID → 모달 ID)
     */
    getModalId(normalizedId) {
        return this.reverseAliases[normalizedId] || normalizedId;
    },

    // ========== 유틸리티 메소드 ==========

    /**
     * ID 정규화 (별칭 처리)
     */
    normalizeId(id) {
        return this.aliases[id] || id;
    },

    /**
     * 지표 설정 가져오기
     */
    get(id) {
        const normalizedId = this.normalizeId(id);
        return this.overlay[normalizedId] || this.panel[normalizedId] || null;
    },

    /**
     * 모든 활성화된 지표 가져오기
     */
    getEnabled() {
        const enabled = [];
        Object.values(this.overlay).forEach(ind => {
            if (ind.enabled) enabled.push(ind);
        });
        Object.values(this.panel).forEach(ind => {
            if (ind.enabled) enabled.push(ind);
        });
        return enabled;
    },

    /**
     * 활성화된 패널 지표 개수
     */
    getEnabledPanelCount() {
        return Object.values(this.panel).filter(ind => ind.enabled).length;
    },

    /**
     * 지표 파라미터 업데이트
     */
    updateParams(id, params) {
        const config = this.get(id);
        if (config) {
            Object.assign(config.params, params);
        }
    },

    /**
     * 지표 스타일 업데이트
     */
    updateStyle(id, style) {
        const config = this.get(id);
        if (config) {
            Object.assign(config.style, style);
        }
    },

    /**
     * 설정 초기화
     */
    reset(id) {
        // 기본값으로 리셋 - 추후 구현
        console.log(`[IndicatorConfig] Reset ${id} to defaults`);
    },

    /**
     * 설정 저장 (localStorage)
     */
    save() {
        const state = {
            overlay: {},
            panel: {}
        };

        Object.keys(this.overlay).forEach(id => {
            state.overlay[id] = {
                enabled: this.overlay[id].enabled,
                params: { ...this.overlay[id].params },
                style: { ...this.overlay[id].style }
            };
        });

        Object.keys(this.panel).forEach(id => {
            state.panel[id] = {
                enabled: this.panel[id].enabled,
                params: { ...this.panel[id].params },
                style: { ...this.panel[id].style }
            };
        });

        localStorage.setItem('indicator_config', JSON.stringify(state));
        console.log('[IndicatorConfig] Saved to localStorage');
    },

    /**
     * 설정 로드 (localStorage)
     */
    load() {
        try {
            const saved = localStorage.getItem('indicator_config');
            if (!saved) return;

            const state = JSON.parse(saved);

            if (state.overlay) {
                Object.keys(state.overlay).forEach(id => {
                    if (this.overlay[id]) {
                        this.overlay[id].enabled = state.overlay[id].enabled;
                        Object.assign(this.overlay[id].params, state.overlay[id].params);
                        Object.assign(this.overlay[id].style, state.overlay[id].style);
                    }
                });
            }

            if (state.panel) {
                Object.keys(state.panel).forEach(id => {
                    if (this.panel[id]) {
                        this.panel[id].enabled = state.panel[id].enabled;
                        Object.assign(this.panel[id].params, state.panel[id].params);
                        Object.assign(this.panel[id].style, state.panel[id].style);
                    }
                });
            }

            console.log('[IndicatorConfig] Loaded from localStorage');
        } catch (e) {
            console.warn('[IndicatorConfig] Failed to load:', e);
        }
    }
};

// 페이지 로드 시 저장된 설정 복원
if (typeof window !== 'undefined') {
    window.IndicatorConfig = IndicatorConfig;
}
