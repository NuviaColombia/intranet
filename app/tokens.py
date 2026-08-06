"""Tokens firmados para aprobar/rechazar desde el correo."""
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from .config import SECRET_KEY

_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="aprobacion-email")
VALIDEZ_SEGUNDOS = 60 * 60 * 24 * 7  # 7 días


def generar_token(aprobacion_id: int, decision: str) -> str:
    return _serializer.dumps({"a": aprobacion_id, "d": decision})


def leer_token(token: str) -> dict | None:
    try:
        return _serializer.loads(token, max_age=VALIDEZ_SEGUNDOS)
    except (BadSignature, SignatureExpired):
        return None
