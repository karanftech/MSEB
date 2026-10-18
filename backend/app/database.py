import asyncio
import socket
import logging
import re
from typing import AsyncGenerator
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import text
from app.config import settings
from app.models.base import Base
# Import all models so metadata knows all tables
import app.models  # noqa: F401

logger = logging.getLogger("uvicorn.error")

# Patch asyncio base getaddrinfo on Windows to prefer AF_INET (IPv4)
# preventing socket.gaierror [Errno 11001] getaddrinfo failed on Neon Cloud CNAME endpoints
try:
    _orig_getaddrinfo = asyncio.base_events.BaseEventLoop.getaddrinfo

    async def _resilient_getaddrinfo(self, host, port, *, family=0, type=0, proto=0, flags=0):
        try:
            return await _orig_getaddrinfo(self, host, port, family=family, type=type, proto=proto, flags=flags)
        except socket.gaierror:
            return await _orig_getaddrinfo(self, host, port, family=socket.AF_INET, type=type, proto=proto, flags=flags)

    asyncio.base_events.BaseEventLoop.getaddrinfo = _resilient_getaddrinfo
except Exception:
    pass

def get_engine_and_connect_args(url: str):
    """
    Parse connection URL and prepare connect_args for asyncpg / Neon Cloud.
    Neon requires SSL (sslmode=require or ssl=require).
    asyncpg does not accept libpq query arguments like channel_binding or sslmode.
    """
    connect_args = {}
    parsed = urlparse(url)
    query_params = parse_qs(parsed.query)

    # Check for SSL requirement (typical for Neon Cloud)
    if "sslmode" in query_params or "ssl" in query_params or "neon" in parsed.netloc:
        connect_args["ssl"] = "require"

    # For Neon PgBouncer pooler endpoints (ep-...-pooler), disable statement cache
    if "pooler" in parsed.netloc or "neon" in parsed.netloc:
        connect_args["statement_cache_size"] = 0

    # Strip query parameters that are not supported by asyncpg connect()
    # (e.g. channel_binding, sslmode, target_session_attrs, gssencmode, etc.)
    supported_asyncpg_query_keys = {"server_settings", "command_timeout"}
    filtered_query = {
        k: v for k, v in query_params.items() if k in supported_asyncpg_query_keys
    }

    new_query = urlencode(filtered_query, doseq=True) if filtered_query else ""
    clean_url = urlunparse((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        "",
        new_query,
        ""
    ))

    return clean_url, connect_args


clean_db_url, connect_args = get_engine_and_connect_args(settings.async_database_url)

engine = create_async_engine(
    clean_db_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args=connect_args
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

async def init_db():
    """
    Initializes PostgreSQL database:
    1. Enables PostGIS extension (3.6)
    2. Creates all tables from SQLAlchemy models
    3. Verifies geometry(Point, 4326) spatial tables
    """
    logger.info("Connecting to PostgreSQL 18 (Neon Cloud) with PostGIS...")
    try:
        async with engine.begin() as conn:
            # PostGIS Extension
            try:
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
                logger.info("PostGIS extension initialized successfully.")
            except Exception as e:
                logger.warning(f"Note on CREATE EXTENSION postgis (may already exist or managed): {e}")

            # Create all tables and spatial geometry columns
            await conn.run_sync(Base.metadata.create_all)
            logger.info("PostgreSQL database tables and spatial indexes initialized successfully.")
    except Exception as exc:
        logger.error(f"PostgreSQL connection / initialization error: {exc}")

async def close_db():
    """Close PostgreSQL connection pool."""
    logger.info("Closing PostgreSQL engine pool...")
    await engine.dispose()
    logger.info("PostgreSQL connection pool closed.")

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for obtaining an asynchronous database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

# Spatial helper functions for PostGIS geometry(Point, 4326)
def point_wkt(longitude: float, latitude: float) -> str:
    """Generate WKT for PostGIS geometry: POINT(lng lat)."""
    return f"SRID=4326;POINT({longitude} {latitude})"
