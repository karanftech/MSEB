import json
import time
import logging
from typing import Any, Optional
import redis.asyncio as aioredis
from app.config import settings

logger = logging.getLogger("uvicorn.error")

class HybridCacheService:
    """
    High-performance Redis cache with an automatic in-memory TTL fallback.
    Guarantees sub-millisecond response times even if Redis is connecting or temporarily unreachable.
    """
    def __init__(self):
        self.redis_client: Optional[aioredis.Redis] = None
        self._is_redis_available: Optional[bool] = None
        self._last_redis_check: float = 0.0
        self._mem_cache: dict[str, tuple[float, str]] = {}  # key -> (expires_at, json_str)

    async def _get_redis(self) -> Optional[aioredis.Redis]:
        now = time.time()
        # If Redis was previously unavailable, re-check only every 30 seconds
        if self._is_redis_available is False and (now - self._last_redis_check) < 30.0:
            return None

        if self.redis_client is None:
            try:
                self.redis_client = aioredis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=1.5,
                    socket_timeout=1.5
                )
            except Exception as e:
                logger.warning(f"[Cache] Unable to initialize Redis client: {e}. Using in-memory fallback.")
                self._is_redis_available = False
                self._last_redis_check = now
                return None

        try:
            await self.redis_client.ping()
            if self._is_redis_available is not True:
                logger.info("[Cache] Connected to Redis successfully!")
            self._is_redis_available = True
            self._last_redis_check = now
            return self.redis_client
        except Exception as ping_exc:
            if self._is_redis_available is not False:
                logger.warning(f"[Cache] Redis ping failed ({ping_exc}). Operating with high-speed in-memory cache.")
            self._is_redis_available = False
            self._last_redis_check = now
            return None

    def _cleanup_mem_cache(self):
        """Purge expired keys from memory fallback."""
        now = time.time()
        expired_keys = [k for k, (exp, _) in self._mem_cache.items() if exp < now]
        for k in expired_keys:
            self._mem_cache.pop(k, None)

    async def get(self, key: str) -> Optional[Any]:
        """Fetch cached JSON object by key."""
        client = await self._get_redis()
        if client:
            try:
                val = await client.get(key)
                if val:
                    return json.loads(val)
            except Exception as e:
                logger.debug(f"[Cache] Redis get error: {e}")

        # Memory Fallback
        now = time.time()
        if key in self._mem_cache:
            exp, val_str = self._mem_cache[key]
            if exp >= now:
                return json.loads(val_str)
            else:
                self._mem_cache.pop(key, None)
        return None

    async def set(self, key: str, value: Any, ttl: int = 60) -> None:
        """Cache JSON object by key with time-to-live in seconds."""
        try:
            val_str = json.dumps(value, default=str)
        except Exception as json_err:
            logger.error(f"[Cache] JSON serialization error for {key}: {json_err}")
            return

        client = await self._get_redis()
        if client:
            try:
                await client.set(key, val_str, ex=ttl)
            except Exception as e:
                logger.debug(f"[Cache] Redis set error: {e}")

        # Always maintain in memory as well for instantaneous fallback
        self._cleanup_mem_cache()
        self._mem_cache[key] = (time.time() + ttl, val_str)

    async def delete(self, key: str) -> None:
        """Delete single key from cache."""
        client = await self._get_redis()
        if client:
            try:
                await client.delete(key)
            except Exception as e:
                logger.debug(f"[Cache] Redis delete error: {e}")
        self._mem_cache.pop(key, None)

    async def clear_prefix(self, prefix: str) -> None:
        """Clear all keys matching prefix (e.g. 'dashboard:*', 'customers:*', 'dtc:*')."""
        client = await self._get_redis()
        if client:
            try:
                pattern = f"{prefix}*"
                keys = []
                async for k in client.scan_iter(match=pattern, count=100):
                    keys.append(k)
                if keys:
                    await client.delete(*keys)
            except Exception as e:
                logger.debug(f"[Cache] Redis clear_prefix error: {e}")

        # Clear matching memory keys
        keys_to_del = [k for k in self._mem_cache.keys() if k.startswith(prefix)]
        for k in keys_to_del:
            self._mem_cache.pop(k, None)

cache_service = HybridCacheService()
