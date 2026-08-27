import logging
import os
import sys
from contextlib import asynccontextmanager

# Ensure backend directory is on sys.path regardless of execution working directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("harvex.main")

import database
from model import classifier
from routes import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifespan handler."""
    logger.info("Initializing Harvex backend system...")
    
    # 1. Initialize SQLite tables
    database.init_db()
    logger.info("SQLite database initialized successfully.")

    # 2. Pre-load Vision Transformer disease classification model
    try:
        classifier.load()
        logger.info("Disease classification model loaded into memory.")
    except Exception as e:
        logger.error(f"Error loading disease classification model: {e}")

    logger.info("Harvex backend ready to accept requests.")
    yield
    logger.info("Harvex backend shutting down.")


# Create FastAPI application
app = FastAPI(
    title="Harvex — AI Smart Farming Assistant API",
    description="Backend API for Harvex ESP32 telemetry, weather fusion, disease detection, and live farm vitals.",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend and external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from fastapi.encoders import jsonable_encoder

# Custom handler: Reject malformed requests with a clear HTTP 400 error as per requirement 6
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    error_messages = []
    for err in exc.errors():
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        msg = err.get("msg", "Invalid value")
        error_messages.append(f"{loc}: {msg}")
    
    error_detail = "; ".join(error_messages)
    logger.warning(f"Validation error on {request.url.path}: {error_detail}")
    
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "detail": f"Malformed request payload: {error_detail}",
            "errors": jsonable_encoder(exc.errors())
        }
    )


# Include API Router under /api prefix
app.include_router(api_router)


@app.get("/", tags=["Health Check"])
async def root():
    return {
        "project": "Harvex — AI Smart Farming Assistant (SIH26180)",
        "team": "Goldsmiths",
        "status": "online",
        "docs_url": "/docs"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
