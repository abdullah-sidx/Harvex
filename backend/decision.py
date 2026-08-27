import os
from typing import Dict, Any, Tuple, Literal

DRY_THRESHOLD = float(os.getenv("DRY_THRESHOLD", "30.0"))
RAIN_THRESHOLD = float(os.getenv("RAIN_THRESHOLD", "0.5"))
MAX_PUMP_RUNTIME_SECONDS = int(os.getenv("MAX_PUMP_RUNTIME_SECONDS", "30"))


def compute_water_needed(soil_moisture_pct: float) -> bool:
    """True if soil moisture falls below the dry threshold."""
    return soil_moisture_pct < DRY_THRESHOLD


def compute_pump_command(
    soil_moisture_pct: float,
    rain_expected: bool
) -> Dict[str, Any]:
    """
    Compute pump command and LCD display message according to decision logic.
    - pump_on = water_needed AND NOT rain_expected
    """
    water_needed = compute_water_needed(soil_moisture_pct)
    pump_on = water_needed and (not rain_expected)

    if pump_on:
        return {
            "pump_command": "on",
            "max_runtime_seconds": MAX_PUMP_RUNTIME_SECONDS,
            "display_message": "Watering: dry soil"
        }
    elif water_needed and rain_expected:
        return {
            "pump_command": "off",
            "max_runtime_seconds": 0,
            "display_message": "Rain expected: skipping"
        }
    else:
        return {
            "pump_command": "off",
            "max_runtime_seconds": 0,
            "display_message": "Soil moisture optimal"
        }


def compute_crop_health_score(
    soil_moisture_pct: float,
    latest_disease_result: Dict[str, Any]
) -> Literal["Healthy", "Needs Water", "Disease Risk", "Needs Water + Disease Risk"]:
    """
    Compute comprehensive crop health score based on soil moisture and disease detection.
    Enum values: 'Healthy' | 'Needs Water' | 'Disease Risk' | 'Needs Water + Disease Risk'
    """
    needs_water = compute_water_needed(soil_moisture_pct)
    
    disease_class = latest_disease_result.get("disease_class", "uncertain")
    confidence = latest_disease_result.get("confidence", 0.0)

    # Disease risk is active if a confirmed non-healthy disease was identified with confidence >= 0.70
    has_disease_risk = (
        disease_class not in {"Healthy", "uncertain"} 
        and confidence >= 0.70
    )

    if needs_water and has_disease_risk:
        return "Needs Water + Disease Risk"
    elif needs_water and not has_disease_risk:
        return "Needs Water"
    elif (not needs_water) and has_disease_risk:
        return "Disease Risk"
    else:
        return "Healthy"
