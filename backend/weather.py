import os
import time
import logging
from typing import Tuple
import httpx

logger = logging.getLogger("harvex.weather")

# Configuration (lat/lon for demo field location, configurable via env)
DEFAULT_LAT = float(os.getenv("FIELD_LATITUDE", "28.6139"))   # Default: Demo Field Lat
DEFAULT_LON = float(os.getenv("FIELD_LONGITUDE", "77.2090"))  # Default: Demo Field Lon
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
RAIN_THRESHOLD = float(os.getenv("RAIN_THRESHOLD", "0.5"))
CACHE_TTL_SECONDS = int(os.getenv("WEATHER_CACHE_TTL", "600"))  # 10 minutes cache

# In-memory cache: (cached_at_timestamp, rain_probability, rain_expected)
_weather_cache = {
    "timestamp": 0.0,
    "rain_probability": 0.0,
    "rain_expected": False
}


def _fetch_from_openmeteo(lat: float, lon: float) -> float:
    """Fetch hourly rain probability from free Open-Meteo API (no API key required)."""
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=precipitation_probability&forecast_days=1"
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
        hourly_probs = data.get("hourly", {}).get("precipitation_probability", [])
        if not hourly_probs:
            return 0.0
        
        # Check next 6 hours precipitation probability
        next_hours = hourly_probs[:6]
        max_prob_pct = max(next_hours) if next_hours else 0.0
        return float(max_prob_pct) / 100.0


def _fetch_from_openweathermap(lat: float, lon: float, api_key: str) -> float:
    """Fetch rain probability from OpenWeatherMap 5-day / 3-hour forecast API."""
    url = f"https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&appid={api_key}&units=metric"
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.json()
        forecast_list = data.get("list", [])
        if not forecast_list:
            return 0.0
        
        # Check probability of precipitation (pop: 0.0 to 1.0) in the upcoming forecasts (next 6-9 hrs)
        pops = [item.get("pop", 0.0) for item in forecast_list[:2]]
        return float(max(pops)) if pops else 0.0


def get_rain_forecast(lat: float = DEFAULT_LAT, lon: float = DEFAULT_LON) -> Tuple[float, bool]:
    """
    Get rain probability and boolean rain_expected status for the field location.
    Cached for 10 minutes.
    Returns: (rain_probability: float [0.0-1.0], rain_expected: bool)
    """
    global _weather_cache
    current_time = time.time()

    # Check if cached data is still valid
    if (current_time - _weather_cache["timestamp"]) < CACHE_TTL_SECONDS:
        return _weather_cache["rain_probability"], _weather_cache["rain_expected"]

    rain_prob = 0.0
    fetched_successfully = False

    # 1. Try OpenWeatherMap if key is provided
    if OPENWEATHER_API_KEY:
        try:
            rain_prob = _fetch_from_openweathermap(lat, lon, OPENWEATHER_API_KEY)
            fetched_successfully = True
            logger.info(f"Fetched weather from OpenWeatherMap: rain_prob={rain_prob:.2f}")
        except Exception as e:
            logger.warning(f"OpenWeatherMap call failed: {e}. Falling back to Open-Meteo.")

    # 2. Try Open-Meteo if not fetched yet or as primary free provider
    if not fetched_successfully:
        try:
            rain_prob = _fetch_from_openmeteo(lat, lon)
            fetched_successfully = True
            logger.info(f"Fetched weather from Open-Meteo: rain_prob={rain_prob:.2f}")
        except Exception as e:
            logger.error(f"Open-Meteo weather API call failed: {e}")

    # 3. Fail-safe fallback: If all calls fail, default rain_expected to False
    if not fetched_successfully:
        logger.warning("Weather API unavailable. Applying fail-safe: default rain_expected=False.")
        rain_prob = 0.0

    rain_expected = rain_prob > RAIN_THRESHOLD

    # Update 10-minute cache
    _weather_cache = {
        "timestamp": current_time,
        "rain_probability": rain_prob,
        "rain_expected": rain_expected
    }

    return rain_prob, rain_expected
