# app/utils/crypto.py
"""
AES 암호화 유틸리티 (Fernet 기반)
- MT5 비밀번호 암호화/복호화
- 키는 환경변수 MT5_ENCRYPT_KEY에서 읽기
- 키가 없으면 자동 생성하여 .env에 저장
"""

import os
from cryptography.fernet import Fernet
from pathlib import Path

# .env 파일 경로
ENV_FILE = Path(__file__).parent.parent.parent / ".env"

def _load_or_generate_key() -> bytes:
    """암호화 키 로드 또는 생성"""
    key = os.environ.get("MT5_ENCRYPT_KEY")

    if key:
        return key.encode()

    # 키가 없으면 새로 생성
    new_key = Fernet.generate_key()

    # .env 파일에 저장
    try:
        # 기존 .env 내용 읽기
        if ENV_FILE.exists():
            content = ENV_FILE.read_text()
        else:
            content = ""

        # MT5_ENCRYPT_KEY가 이미 있는지 확인
        if "MT5_ENCRYPT_KEY=" not in content:
            # 새 키 추가
            with open(ENV_FILE, "a") as f:
                f.write(f"\n# MT5 비밀번호 암호화 키 (자동 생성됨)\n")
                f.write(f"MT5_ENCRYPT_KEY={new_key.decode()}\n")
            print(f"[Crypto] 새 암호화 키 생성 및 .env에 저장됨")

        # 환경변수에도 설정
        os.environ["MT5_ENCRYPT_KEY"] = new_key.decode()

    except Exception as e:
        print(f"[Crypto] .env 저장 실패: {e}")

    return new_key


def get_fernet() -> Fernet:
    """Fernet 인스턴스 반환"""
    key = _load_or_generate_key()
    return Fernet(key)


def encrypt(plain_text: str) -> str:
    """
    문자열 암호화
    Args:
        plain_text: 암호화할 평문
    Returns:
        암호화된 문자열 (base64 인코딩)
    """
    if not plain_text:
        return None

    try:
        f = get_fernet()
        encrypted = f.encrypt(plain_text.encode())
        return encrypted.decode()
    except Exception as e:
        print(f"[Crypto] 암호화 실패: {e}")
        return None


def decrypt(encrypted_text: str) -> str:
    """
    암호화된 문자열 복호화
    Args:
        encrypted_text: 암호화된 문자열
    Returns:
        복호화된 평문
    """
    if not encrypted_text:
        return None

    try:
        f = get_fernet()
        decrypted = f.decrypt(encrypted_text.encode())
        return decrypted.decode()
    except Exception as e:
        print(f"[Crypto] 복호화 실패: {e}")
        return None


# 테스트용
if __name__ == "__main__":
    test_password = "MySecretPassword123!"

    encrypted = encrypt(test_password)
    print(f"원본: {test_password}")
    print(f"암호화: {encrypted}")

    decrypted = decrypt(encrypted)
    print(f"복호화: {decrypted}")

    assert test_password == decrypted, "암호화/복호화 실패!"
    print("테스트 성공!")
