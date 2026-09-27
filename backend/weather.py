import os
import time
import logging
import asyncio
from typing import Tuple, Dict
import httpx

logger = logging.getLogger("harvex.weather")

DEFAULT_LAT = float(os.getenv("FIELD_LATITUDE", "28.6139"))
DEFAULT_LON = float(os.getenv("FIELD_LONGITUDE", "77.2090"))
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
RAIN_THRESHOLD = float(os.getenv("RAIN_THRESHOLD", "0.5"))
CACHE_TTL_SECONDS = int(os.getenv("WEATHER_CACHE_TTL", "600"))

_weather_cache: Dict[str, any] = {"timestamp": 0.0, "rain_probability": 0.0, "rain_expected": False, "lat": DEFAULT_LAT, "lon": DEFAULT_LON}

async def _fetch_from_openmeteo_async(lat: float, lon: float) -> float:
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=precipitation_probability&forecast_days=1"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        hourly_probs = data.get("hourly", {}).get("precipitation_probability", [])
        if not hourly_probs:
            return 0.0
        now = time.gmtime()
        current_hour = now.tm_hour
        next_hours = hourly_probs[current_hour:current_hour + 6]
        if not next_hours:
            return 0.0
        max_prob_pct = max(next_hours)
        return float(max_prob_pct) / 100.0

def _fetch_from_openweathermap(lat: float, lon: float, api_key: str) -> float:
    import httpx as _httpx
    url = f"https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&appid={api_key}&units=metric"
    with _httpx.Client(timeout=5.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
        forecast_list = data.get("list", [])
        if not forecast_list:
            return 0.0
        pops = [item.get("pop", 0.0) for item in forecast_list[:6]]
        return float(max(pops)) if pops else 0.0

async def get_rain_forecast(lat: float = DEFAULT_LAT, lon: float = DEFAULT_LON) -> Tuple[float, bool]:
    global _weather_cache
    current_time = time.time()
    if (current_time - _weather_cache["timestamp"]) < CACHE_TTL_SECONDS and abs(_weather_cache["lat"] - lat) < 0.01 and abs(_weather_cache["lon"] - lon) < 0.01:
        return _weather_cache["rain_probability"], _weather_cache["rain_expected"]
    rain_prob = 0.0
    fetched_successfully = False
    if OPENWEATHER_API_KEY:
        try:
            rain_prob = _fetch_from_openweathermap(lat, lon, OPENWEATHER_API_KEY)
            fetched_successfully = True
            logger.info(f"Fetched weather from OpenWeatherMap: rain_prob={rain_prob:.2f}")
        except Exception as e:
            logger.warning(f"OpenWeatherMap call failed: {e}. Falling back to Open-Meteo.")
    if not fetched_successfully:
        try:
            rain_prob = await _fetch_from_openmeteo_async(lat, lon)
            fetched_successfully = True
            logger.info(f"Fetched weather from Open-Meteo: rain_prob={rain_prob:.2f}")
        except Exception as e:
            logger.error(f"Open-Meteo weather API call failed: {e}")
    if not fetched_successfully:
        logger.warning("Weather API unavailable. Applying fail-safe: default rain_expected=False.")
        rain_prob = 0.0
    rain_expected = rain_prob > RAIN_THRESHOLD
    _weather_cache = {"timestamp": current_time, "rain_probability": rain_prob, "rain_expected": rain_expected, "lat": lat, "lon": lon}
    return rain_prob, rain_expected
