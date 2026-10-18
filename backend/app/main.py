# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Request, Response
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.config import settings
from app.database import init_db, close_db
from app.services.cache_service import cache_service
from app.routers import auth, customers, payments, routes, officers, assignments, dashboard, reports

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Electricity Bill Collection System Backend with PostgreSQL 18 & PostGIS 3.6...")
    await init_db()
    await cache_service._get_redis()
    yield
    logger.info("Shutting down backend...")
    if cache_service.redis_client:
        try:
            await cache_service.redis_client.aclose()
        except Exception:
            pass
    await close_db()

app = FastAPI(
    title="Electricity Bill Collection & Navigation System API",
    description="Backend services for electricity department field officer collections, GIS map customer tracking, and route calculation.",
    version="1.0.0",
    lifespan=lifespan
)

# Custom Security & Anti-Caching Middleware
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    if request.method != "OPTIONS":
        # Only disable caching on API endpoints (not pages/static assets)
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# Enable CORS for Next.js frontend (Supports Vercel, Render, Localhost, and custom domains)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Register API Routers
app.include_router(auth.router)
app.include_router(customers.router)
app.include_router(payments.router)
app.include_router(routes.router)
app.include_router(officers.router)
app.include_router(assignments.router)
app.include_router(dashboard.router)
app.include_router(reports.router)

@app.get("/", tags=["Health"])
async def root():
    return {
        "status": "online",
        "service": "Electricity Bill Collection & Navigation System API",
        "version": "1.0.0",
        "docs_url": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
