import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str = ""
    POSTGRES_URL: str = ""
    NEON_DATABASE_URL: str = ""
    OSRM_BASE_URL: str = "https://router.project-osrm.org"
    JWT_SECRET: str = "super-secret-jwt-key-change-in-production-2026"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours
    ALLOWED_ORIGINS: str = "*"
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_CACHE_TTL: int = 120  # default 2 minutes

    @property
    def async_database_url(self) -> str:
        raw_url = (
            self.DATABASE_URL
            or self.POSTGRES_URL
            or self.NEON_DATABASE_URL
            or "postgresql+asyncpg://postgres:postgres@localhost:5432/electricity_collection"
        ).strip()

        # Handle Neon / standard PostgreSQL connection formats for asyncpg
        if raw_url.startswith("postgres://"):
            raw_url = raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif raw_url.startswith("postgresql://") and not raw_url.startswith("postgresql+asyncpg://"):
            raw_url = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

        # Handle asyncpg ssl argument in query params if needed
        # asyncpg prefers ssl=require or sslmode=require
        return raw_url

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

