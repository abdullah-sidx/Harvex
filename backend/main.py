import logging
import os
import sys
from contextlib import asynccontextmanager

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
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("harvex.main")

import database
from model import classifier
from telemetry_state import (
    latest_sensor_data,
    sensor_data,
    pending_pump_command,
    get_latest_sensor_data,
    update_latest_sensor_data,
    get_pending_pump_command,
    set_pending_pump_command,
)
from schemas import SensorDataPayload, SensorDataResponse
from routes import router as api_router
from security import rate_limiter, get_client_ip, validate_image_file, MAX_FILE_SIZE_BYTES, SecurityHeadersMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Harvex backend system...")
    database.init_db()
    logger.info("SQLite database initialized successfully.")
    try:
        classifier.load()
        logger.info("Disease classification model loaded into memory.")
    except Exception as e:
        logger.error(f"Error loading disease classification model: {e}")
    logger.info("Harvex backend ready to accept requests.")
    yield
    logger.info("Harvex backend shutting down.")

app = FastAPI(
    title="Harvex — AI Smart Farming Assistant API",
    description="Backend API for Harvex ESP32 telemetry, weather fusion, disease detection, and live farm vitals.",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SecurityHeadersMiddleware)

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
        content={"detail": "Invalid request. Please check your input.", "errors": []}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = str(__import__('uuid').uuid4().hex[:8])
    logger.error(f"[{request_id}] Unhandled error on {request.url.path}: {repr(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An internal server error occurred. Please try again later.", "request_id": request_id}
    )

app.include_router(api_router)

@app.get("/", tags=["Health Check"])
async def root():
    return {"project": "Harvex — AI Smart Farming Assistant (SIH26180)", "team": "Goldsmiths", "status": "online", "docs_url": "/docs"}

@app.get("/sensor-data", tags=["Hardware Telemetry"], include_in_schema=False)
async def get_sensor_data_root():
    from routes import get_sensor_data_endpoint
    return await get_sensor_data_endpoint()

@app.post("/sensor-data", response_model=SensorDataResponse, tags=["Hardware Telemetry"], include_in_schema=False)
async def post_sensor_data_root(payload: SensorDataPayload):
    from routes import post_sensor_data
    return await post_sensor_data(payload)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
