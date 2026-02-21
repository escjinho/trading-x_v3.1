"""IP → 국가/도시 변환 (ip-api.com 무료 API)
- 무료: 분당 45건 (로그인 시에만 호출하므로 충분)
- 응답: country, countryCode, city, regionName, timezone 등
- 실패 시 빈 값 반환 (로그인에 영향 없음)
"""
import requests

# 국가코드 → 한국어 이름 매핑
COUNTRY_NAMES = {
    'KR': '대한민국', 'US': '미국', 'JP': '일본', 'CN': '중국',
    'VN': '베트남', 'TH': '태국', 'PH': '필리핀', 'MY': '말레이시아',
    'SG': '싱가포르', 'AU': '호주', 'GB': '영국', 'DE': '독일',
    'FR': '프랑스', 'CA': '캐나다', 'IN': '인도', 'ID': '인도네시아',
    'TW': '대만', 'HK': '홍콩', 'RU': '러시아', 'BR': '브라질',
    'MX': '멕시코', 'AE': '아랍에미리트', 'SA': '사우디아라비아',
}

# 국가코드 → 추천 언어 매핑
COUNTRY_TO_LANG = {
    'KR': 'ko', 'US': 'en', 'GB': 'en', 'AU': 'en', 'CA': 'en',
    'JP': 'ja', 'CN': 'zh', 'TW': 'zh', 'HK': 'zh',
    'VN': 'vi', 'TH': 'th', 'PH': 'en', 'MY': 'en', 'SG': 'en',
    'IN': 'en', 'ID': 'id', 'DE': 'de', 'FR': 'fr',
    'BR': 'pt', 'MX': 'es', 'RU': 'ru', 'AE': 'ar', 'SA': 'ar',
}


def get_ip_location(ip_address: str) -> dict:
    """IP 주소로 위치 정보 조회
    
    Returns:
        {
            "country": "South Korea",
            "country_code": "KR",
            "city": "Seoul",
            "region": "Seoul",
            "location": "Seoul, South Korea",
            "timezone": "Asia/Seoul",
            "lang": "ko"
        }
    """
    result = {
        "country": "", "country_code": "", "city": "",
        "region": "", "location": "", "timezone": "", "lang": "en"
    }

    # 로컬 IP는 조회 불가
    if not ip_address or ip_address in ('127.0.0.1', 'localhost', '::1', 'unknown'):
        result["location"] = "Local"
        return result

    # 사설 IP 체크
    if ip_address.startswith(('10.', '172.16.', '172.17.', '172.18.', '172.19.',
                               '172.20.', '172.21.', '172.22.', '172.23.',
                               '172.24.', '172.25.', '172.26.', '172.27.',
                               '172.28.', '172.29.', '172.30.', '172.31.',
                               '192.168.')):
        result["location"] = "Private Network"
        return result

    try:
        resp = requests.get(
            f"http://ip-api.com/json/{ip_address}?fields=status,country,countryCode,regionName,city,timezone",
            timeout=3
        )
        data = resp.json()

        if data.get("status") == "success":
            cc = data.get("countryCode", "")
            city = data.get("city", "")
            country = data.get("country", "")
            region = data.get("regionName", "")

            result["country"] = country
            result["country_code"] = cc
            result["city"] = city
            result["region"] = region
            result["timezone"] = data.get("timezone", "")

            # 위치 문자열 조합
            if city and country:
                result["location"] = f"{city}, {country}"
            elif country:
                result["location"] = country
            
            # 추천 언어
            result["lang"] = COUNTRY_TO_LANG.get(cc, "en")

            print(f"[IP-LOCATION] {ip_address} → {city}, {cc} (lang: {result['lang']})")

    except Exception as e:
        print(f"[IP-LOCATION] 조회 실패 ({ip_address}): {e}")

    return result
