# app/symbol_config.py
"""
Trading-X 심볼 설정 단일 관리 파일
====================================
★★★ 심볼 추가/수정은 SYMBOL_CONFIG 딕셔너리만 변경하면 됩니다 ★★★
SYMBOLS, SYMBOL_SPECS, _MARKET_SCHEDULE 등은 아래에서 자동 생성됩니다.
"""

SYMBOL_CONFIG = {
    # ===== 크립토 =====
    'BTCUSD': {
        'contract_size': 1, 'tick_size': 0.01, 'tick_value': 0.01, 'digits': 2,
        'volatility': 50.0,
        'schedule': {
            'sun': '00:02-23:57', 'mon': '00:02-23:57', 'tue': '00:02-23:57',
            'wed': '00:02-23:57', 'thu': '00:02-23:57', 'fri': '00:02-23:57',
            'sat': '00:02-09:30,12:30-14:00,15:00-23:57'
        },
        'watchlist_tab': 'crypto', 'in_popular': True, 'in_trade_panel': True,
    },
    'ETHUSD': {
        'contract_size': 1, 'tick_size': 0.01, 'tick_value': 0.01, 'digits': 2,
        'volatility': 5.0,
        'schedule': {
            'sun': '00:02-23:57', 'mon': '00:02-23:57', 'tue': '00:02-23:57',
            'wed': '00:02-23:57', 'thu': '00:02-23:57', 'fri': '00:02-23:57',
            'sat': '00:02-09:30,12:30-14:00,15:00-23:57'
        },
        'watchlist_tab': 'crypto', 'in_popular': False, 'in_trade_panel': False,
    },
    # ===== FX =====
    'EURUSD.r': {
        'contract_size': 100000, 'tick_size': 0.00001, 'tick_value': 1.0, 'digits': 5,
        'volatility': 0.0003,
        'schedule': {
            'mon': '00:02-23:58', 'tue': '00:02-23:58', 'wed': '00:02-23:58',
            'thu': '00:02-23:58', 'fri': '00:02-23:58'
        },
        'watchlist_tab': 'forex', 'in_popular': True, 'in_trade_panel': True,
    },
    'USDJPY.r': {
        'contract_size': 100000, 'tick_size': 0.001, 'tick_value': 0.67, 'digits': 3,
        'volatility': 0.03,
        'schedule': {
            'mon': '00:02-23:58', 'tue': '00:02-23:58', 'wed': '00:02-23:58',
            'thu': '00:02-23:58', 'fri': '00:02-23:58'
        },
        'watchlist_tab': 'forex', 'in_popular': True, 'in_trade_panel': True,
    },
    'GBPUSD.r': {
        'contract_size': 100000, 'tick_size': 0.00001, 'tick_value': 1.0, 'digits': 5,
        'volatility': 0.0003,
        'schedule': {
            'mon': '00:02-23:58', 'tue': '00:02-23:58', 'wed': '00:02-23:58',
            'thu': '00:02-23:58', 'fri': '00:02-23:58'
        },
        'watchlist_tab': 'forex', 'in_popular': False, 'in_trade_panel': False,
    },
    'AUDUSD.r': {
        'contract_size': 100000, 'tick_size': 0.00001, 'tick_value': 1.0, 'digits': 5,
        'volatility': 0.0002,
        'schedule': {
            'mon': '00:02-23:58', 'tue': '00:02-23:58', 'wed': '00:02-23:58',
            'thu': '00:02-23:58', 'fri': '00:02-23:58'
        },
        'watchlist_tab': 'forex', 'in_popular': False, 'in_trade_panel': False,
    },
    'USDCAD.r': {
        'contract_size': 100000, 'tick_size': 0.00001, 'tick_value': 0.74, 'digits': 5,
        'volatility': 0.0002,
        'schedule': {
            'mon': '00:02-23:58', 'tue': '00:02-23:58', 'wed': '00:02-23:58',
            'thu': '00:02-23:58', 'fri': '00:02-23:58'
        },
        'watchlist_tab': 'forex', 'in_popular': False, 'in_trade_panel': False,
    },
    # ===== 귀금속 =====
    'XAUUSD.r': {
        'contract_size': 100, 'tick_size': 0.01, 'tick_value': 1.0, 'digits': 2,
        'volatility': 0.5,
        'schedule': {
            'mon': '01:02-23:58', 'tue': '01:02-23:58', 'wed': '01:02-23:58',
            'thu': '01:02-23:58', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'metals', 'in_popular': True, 'in_trade_panel': True,
    },
    'XAGUSD.r': {
        'contract_size': 5000, 'tick_size': 0.001, 'tick_value': 5.0, 'digits': 3,
        'volatility': 0.05,
        'schedule': {
            'mon': '01:02-23:58', 'tue': '01:02-23:58', 'wed': '01:02-23:58',
            'thu': '01:02-23:58', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'metals', 'in_popular': False, 'in_trade_panel': False,
    },
    # ===== 지수 =====
    'US100.': {
        'contract_size': 20, 'tick_size': 0.01, 'tick_value': 0.2, 'digits': 2,
        'volatility': 5.0,
        'schedule': {
            'mon': '01:02-23:58', 'tue': '01:02-23:58', 'wed': '01:02-23:58',
            'thu': '01:02-23:58', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'indices', 'in_popular': True, 'in_trade_panel': True,
    },
    'US500.': {
        'contract_size': 10, 'tick_size': 0.01, 'tick_value': 0.1, 'digits': 2,
        'volatility': 3.0,
        'schedule': {
            'mon': '01:02-23:58', 'tue': '01:02-23:58', 'wed': '01:02-23:58',
            'thu': '01:02-23:58', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'indices', 'in_popular': False, 'in_trade_panel': False,
    },
    'US30.': {
        'contract_size': 5, 'tick_size': 0.01, 'tick_value': 0.05, 'digits': 2,
        'volatility': 10.0,
        'schedule': {
            'mon': '01:02-23:58', 'tue': '01:02-23:58', 'wed': '01:02-23:58',
            'thu': '01:02-23:58', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'indices', 'in_popular': False, 'in_trade_panel': False,
    },
    # ===== 에너지 =====
    'XBRUSD': {
        'contract_size': 1000, 'tick_size': 0.01, 'tick_value': 10.0, 'digits': 2,
        'volatility': 0.3,
        'schedule': {
            'mon': '01:02-23:55', 'tue': '01:02-23:55', 'wed': '01:02-23:55',
            'thu': '01:02-23:55', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'energy', 'in_popular': False, 'in_trade_panel': False,
    },
    'XTIUSD': {
        'contract_size': 1000, 'tick_size': 0.01, 'tick_value': 10.0, 'digits': 2,
        'volatility': 0.3,
        'schedule': {
            'mon': '01:02-23:55', 'tue': '01:02-23:55', 'wed': '01:02-23:55',
            'thu': '01:02-23:55', 'fri': '01:02-23:55'
        },
        'watchlist_tab': 'energy', 'in_popular': False, 'in_trade_panel': False,
    },
}

# ============================================================
# ★★★ 아래는 자동 생성 — 직접 수정하지 마세요 ★★★
# ============================================================
SYMBOLS = list(SYMBOL_CONFIG.keys())

SYMBOL_SPECS = {
    sym: {
        'contract_size': cfg['contract_size'],
        'tick_size':     cfg['tick_size'],
        'tick_value':    cfg['tick_value'],
        'digits':        cfg['digits'],
    }
    for sym, cfg in SYMBOL_CONFIG.items()
}

_MARKET_SCHEDULE = {
    sym: cfg['schedule']
    for sym, cfg in SYMBOL_CONFIG.items()
    if 'schedule' in cfg
}

SYMBOL_VOLATILITY = {
    sym: cfg.get('volatility', cfg['tick_size'] * 100)
    for sym, cfg in SYMBOL_CONFIG.items()
}

print(f"[SymbolConfig] ✅ 로드 완료 — {len(SYMBOLS)}개 심볼: {', '.join(SYMBOLS)}")
