import os
import time
import uuid
from typing import Dict, Optional
from datetime import datetime
from collections import defaultdict
from fastapi import Request, HTTPException

class SecurityHeadersMiddleware:
    _HEADERS = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"x-xss-protection", b"1; mode=block"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"cache-control", b"no-store"),
    ]

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                existing = {k.lower() for k, _ in headers}
                for name, value in self._HEADERS:
                    if name not in existing:
                        headers.append((name, value))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)

# Rate limit configuration from env vars
RATE_LIMITS = {
    "auth_strict": {
        "requests_per_window": int(os.getenv("RATE_LIMIT_AUTH_REQUESTS", "5")),
        "window_seconds": int(os.getenv("RATE_LIMIT_AUTH_WINDOW", "60")),
        "max_burst": int(os.getenv("RATE_LIMIT_AUTH_BURST", "3")),
        "backoff_multiplier": 2,
        "max_backoff_seconds": int(os.getenv("RATE_LIMIT_AUTH_MAX_BACKOFF", "300")),
    },
    "public": {
        "requests_per_window": int(os.getenv("RATE_LIMIT_PUBLIC_REQUESTS", "60")),
        "window_seconds": int(os.getenv("RATE_LIMIT_PUBLIC_WINDOW", "60")),
        "max_burst": int(os.getenv("RATE_LIMIT_PUBLIC_BURST", "10")),
        "backoff_multiplier": 2,
        "max_backoff_seconds": int(os.getenv("RATE_LIMIT_PUBLIC_MAX_BACKOFF", "60")),
    },
    "authenticated": {
        "requests_per_window": int(os.getenv("RATE_LIMIT_AUTHENTICATED_REQUESTS", "30")),
        "window_seconds": int(os.getenv("RATE_LIMIT_AUTHENTICATED_WINDOW", "60")),
        "max_burst": int(os.getenv("RATE_LIMIT_AUTHENTICATED_BURST", "5")),
        "backoff_multiplier": 2,
        "max_backoff_seconds": int(os.getenv("RATE_LIMIT_AUTHENTICATED_MAX_BACKOFF", "120")),
    },
}

class RateLimiter:
    def __init__(self, limits: Dict):
        self.limits = limits
        self._ip_tokens: Dict[str, Dict] = defaultdict(lambda: {
            "tokens": limits["public"]["max_burst"],
            "last_refill": time.time(),
            "violations": 0,
            "backoff_until": 0.0,
        })
        self._account_tokens: Dict[str, Dict] = defaultdict(lambda: {
            "tokens": limits["auth_strict"]["max_burst"],
            "last_refill": time.time(),
            "violations": 0,
            "backoff_until": 0.0,
        })

    def _refill(self, bucket: Dict, limit_config: Dict) -> None:
        now = time.time()
        elapsed = now - bucket["last_refill"]
        max_tokens = limit_config["max_burst"]
        tokens_per_second = limit_config["max_burst"] / limit_config["window_seconds"]
        bucket["tokens"] = min(max_tokens, bucket["tokens"] + elapsed * tokens_per_second)
        bucket["last_refill"] = now

    def check(self, identifier: str, tier: str = "public") -> tuple[bool, Optional[int]]:
        config = self.limits.get(tier, self.limits["public"])
        bucket = self._ip_tokens[identifier] if tier != "auth_strict" else self._account_tokens[identifier]

        if bucket["backoff_until"] > time.time():
            remaining = int(bucket["backoff_until"] - time.time()) + 1
            return False, remaining

        self._refill(bucket, config)

        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True, None
        else:
            bucket["violations"] += 1
            backoff = min(config["max_backoff_seconds"], config["backoff_multiplier"] ** bucket["violations"])
            bucket["backoff_until"] = time.time() + backoff
            bucket["tokens"] = 0.5
            return False, int(backoff)

rate_limiter = RateLimiter(RATE_LIMITS)

MAX_FILE_SIZE_BYTES = int(os.getenv("MAX_FILE_SIZE_BYTES", "10485760"))
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

async def rate_limit_middleware(request: Request, tier: str = "public") -> None:
    """Rate limit check. Raises HTTPException(429) if limit exceeded."""
    ip = get_client_ip(request)
    allowed, retry_after = rate_limiter.check(ip, tier=tier)
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Too many requests. Please retry after {retry_after} seconds.")

async def validate_image_file(image) -> tuple[bool, str]:
    """Validate uploaded image file type and size. Returns (valid, error_message)."""
    if image is None:
        return True, ""
    try:
        content = await image.read()
    except Exception:
        content = b""
    try:
        image.file.seek(0)
    except Exception:
        pass
    if len(content) > MAX_FILE_SIZE_BYTES:
        return False, f"File too large ({len(content)} bytes). Maximum size is {MAX_FILE_SIZE_BYTES} bytes."
    if len(content) >= 8:
        mime = _detect_mime(content)
        if mime and mime not in ALLOWED_IMAGE_TYPES:
            return False, f"Invalid file type '{mime}'. Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}"
    return True, ""

def _detect_mime(data: bytes) -> Optional[str]:
    if data[:2] == b'\xff\xd8': return "image/jpeg"
    if data[:8] == b'\x89PNG\r\n\x1a\n': return "image/png"
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP': return "image/webp"
    if data[:2] == b'BM': return "image/bmp"
    return None
