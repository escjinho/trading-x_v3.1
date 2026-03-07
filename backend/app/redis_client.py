"""
Trading-X Redis Client
- 전역 Redis 연결 관리
- JSON 직렬화/역직렬화 헬퍼
- 캐시 읽기/쓰기 유틸리티
"""

import json
import redis
from typing import Any, Optional, Dict, List

# ★ Redis 연결 (로컬, 포트 6379)
_redis: Optional[redis.Redis] = None

def get_redis() -> redis.Redis:
    """Redis 연결 싱글톤"""
    global _redis
    if _redis is None:
        _redis = redis.Redis(
            host='127.0.0.1',
            port=6379,
            db=0,
            decode_responses=True,  # 문자열 자동 디코딩
            socket_connect_timeout=3,
            socket_timeout=3,
            retry_on_timeout=True,
        )
    return _redis


def is_redis_available() -> bool:
    """Redis 연결 상태 확인"""
    try:
        return get_redis().ping()
    except Exception:
        return False


# ========== JSON 캐시 헬퍼 ==========

def cache_set(key: str, value: Any, ttl: int = 30) -> bool:
    """
    Redis에 JSON 데이터 저장
    - key: Redis 키 (예: "price:BTCUSD")
    - value: dict, list 등 JSON 직렬화 가능한 데이터
    - ttl: 만료 시간 (초). 기본 30초
    """
    try:
        r = get_redis()
        r.set(key, json.dumps(value, default=str), ex=ttl)
        return True
    except Exception as e:
        print(f"[Redis] SET 실패 ({key}): {e}")
        return False


def cache_get(key: str) -> Optional[Any]:
    """
    Redis에서 JSON 데이터 읽기
    - 키가 없거나 만료됐으면 None 반환
    """
    try:
        r = get_redis()
        data = r.get(key)
        if data is None:
            return None
        return json.loads(data)
    except Exception as e:
        print(f"[Redis] GET 실패 ({key}): {e}")
        return None


def cache_delete(key: str) -> bool:
    """Redis 키 삭제"""
    try:
        r = get_redis()
        r.delete(key)
        return True
    except Exception as e:
        print(f"[Redis] DEL 실패 ({key}): {e}")
        return False


# ========== 시세 전용 헬퍼 ==========

def set_price(symbol: str, bid: float, ask: float, ttl: int = 15) -> bool:
    """시세 저장 (TTL 15초 — 15초 동안 업데이트 없으면 자동 만료)"""
    return cache_set(f"price:{symbol}", {"bid": bid, "ask": ask}, ttl=ttl)


def get_price(symbol: str) -> Optional[Dict]:
    """시세 조회"""
    return cache_get(f"price:{symbol}")


def get_all_prices(symbols: List[str]) -> Dict[str, Dict]:
    """여러 종목 시세 일괄 조회"""
    try:
        r = get_redis()
        pipe = r.pipeline()
        for sym in symbols:
            pipe.get(f"price:{sym}")
        results = pipe.execute()

        prices = {}
        for sym, data in zip(symbols, results):
            if data:
                try:
                    prices[sym] = json.loads(data)
                except:
                    pass
        return prices
    except Exception as e:
        print(f"[Redis] get_all_prices 실패: {e}")
        return {}


# ========== 유저 캐시 전용 헬퍼 ==========

def set_user_cache(user_id: int, data: Dict, ttl: int = 30) -> bool:
    """유저별 캐시 저장 (포지션, 잔고 등)"""
    return cache_set(f"user:{user_id}", data, ttl=ttl)


def get_user_cache(user_id: int) -> Optional[Dict]:
    """유저별 캐시 조회"""
    return cache_get(f"user:{user_id}")


def delete_user_cache(user_id: int) -> bool:
    """유저별 캐시 삭제"""
    return cache_delete(f"user:{user_id}")


# ========== 초기화 로그 ==========

print(f"[Redis Client] 모듈 로드됨 — 127.0.0.1:6379")
