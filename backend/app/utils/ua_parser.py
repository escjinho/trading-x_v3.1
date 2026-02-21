"""User-Agent 파싱 유틸리티 (외부 라이브러리 없이)"""
import re

def parse_user_agent(ua_string: str) -> dict:
    """User-Agent 문자열에서 브라우저, OS, 디바이스 타입 추출"""
    if not ua_string:
        return {"browser": "Unknown", "os": "Unknown", "device_type": "unknown"}

    ua = ua_string.lower()

    # 디바이스 타입
    if any(m in ua for m in ['iphone', 'android', 'mobile', 'ipod']):
        device_type = 'mobile'
    elif any(t in ua for t in ['ipad', 'tablet']):
        device_type = 'tablet'
    else:
        device_type = 'desktop'

    # OS 감지
    os_name = "Unknown"
    if 'iphone' in ua or 'ipad' in ua:
        os_name = 'iOS'
        m = re.search(r'os (\d+[_\.]\d+)', ua)
        if m:
            os_name = 'iOS ' + m.group(1).replace('_', '.')
    elif 'mac os' in ua:
        os_name = 'macOS'
    elif 'android' in ua:
        os_name = 'Android'
        m = re.search(r'android (\d+\.?\d*)', ua)
        if m:
            os_name = 'Android ' + m.group(1)
    elif 'windows nt 10' in ua:
        os_name = 'Windows 10/11'
    elif 'windows nt' in ua:
        os_name = 'Windows'
    elif 'linux' in ua:
        os_name = 'Linux'
    elif 'cros' in ua:
        os_name = 'ChromeOS'

    # 브라우저 감지 (순서 중요 - 더 구체적인 것 먼저)
    browser = "Unknown"
    if 'edg/' in ua or 'edge/' in ua:
        browser = 'Edge'
        m = re.search(r'edg/(\d+)', ua)
        if m: browser = f'Edge {m.group(1)}'
    elif 'opr/' in ua or 'opera' in ua:
        browser = 'Opera'
    elif 'whale/' in ua:
        browser = 'Whale'
        m = re.search(r'whale/(\d+)', ua)
        if m: browser = f'Whale {m.group(1)}'
    elif 'samsungbrowser/' in ua:
        browser = 'Samsung Browser'
    elif 'firefox/' in ua:
        browser = 'Firefox'
        m = re.search(r'firefox/(\d+)', ua)
        if m: browser = f'Firefox {m.group(1)}'
    elif 'crios/' in ua:
        browser = 'Chrome'
        m = re.search(r'crios/(\d+)', ua)
        if m: browser = f'Chrome {m.group(1)}'
    elif 'chrome/' in ua and 'chromium' not in ua:
        browser = 'Chrome'
        m = re.search(r'chrome/(\d+)', ua)
        if m: browser = f'Chrome {m.group(1)}'
    elif 'safari/' in ua and 'chrome' not in ua:
        browser = 'Safari'
        m = re.search(r'version/(\d+)', ua)
        if m: browser = f'Safari {m.group(1)}'

    # 디바이스명 보정
    if device_type == 'mobile':
        if 'iphone' in ua:
            device_type = 'mobile'
            os_name = os_name if 'iOS' in os_name else 'iOS'
        elif 'android' in ua:
            device_type = 'mobile'

    return {
        "browser": browser,
        "os": os_name,
        "device_type": device_type
    }
