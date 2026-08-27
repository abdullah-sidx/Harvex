from datetime import datetime, timezone
from typing import Dict, Any, Optional, List

# Global latest_sensor_data for NodeMCU ESP8266 hardware telemetry
latest_sensor_data: Dict[str, Any] = {
    "soil_moisture_pct": 50.0,
    "soil_moisture": 50.0,
    "temperature_c": 24.0,
    "temperature": 24.0,
    "humidity_pct": 68.0,
    "humidity": 68.0,
    "pump_status": "off",
    "device_id": "harvex-node-1",
    "updated_at": None,
    "last_updated_timestamp": None,
}

# Alias for backwards-compatibility
sensor_data = latest_sensor_data

# Global pending_pump_command polled by NodeMCU ESP8266
pending_pump_command: Dict[str, Any] = {
    "pump_command": "off",
    "max_runtime_seconds": 0,
    "display_message": "System Ready",
}

# Flag to track whether manual web toggle is actively overriding automatic decisions
manual_pump_override: bool = False

# In-memory backup pump history list
in_memory_pump_history: List[Dict[str, Any]] = []


def get_latest_sensor_data() -> Dict[str, Any]:
    """Retrieve current in-memory sensor telemetry snapshot."""
    return latest_sensor_data


def get_sensor_data() -> Dict[str, Any]:
    """Alias for backwards compatibility."""
    return latest_sensor_data


def update_latest_sensor_data(
    soil_moisture: float,
    temperature: float,
    humidity: float,
    pump_status: str = "off",
    device_id: str = "harvex-node-1",
    timestamp: Optional[str] = None,
) -> Dict[str, Any]:
    """Update in-memory sensor telemetry and set updated_at ISO timestamp."""
    now_iso = timestamp or datetime.now(timezone.utc).isoformat()
    sm = round(float(soil_moisture), 1)
    tc = round(float(temperature), 1)
    hp = round(float(humidity), 1)
    ps = str(pump_status).strip().lower()

    latest_sensor_data["soil_moisture_pct"] = sm
    latest_sensor_data["soil_moisture"] = sm
    latest_sensor_data["temperature_c"] = tc
    latest_sensor_data["temperature"] = tc
    latest_sensor_data["humidity_pct"] = hp
    latest_sensor_data["humidity"] = hp
    latest_sensor_data["pump_status"] = ps
    latest_sensor_data["device_id"] = device_id
    latest_sensor_data["updated_at"] = now_iso
    latest_sensor_data["last_updated_timestamp"] = now_iso
    return latest_sensor_data


def update_sensor_data(
    soil_moisture: float,
    temperature: float,
    humidity: float,
    pump_status: str = "off",
    timestamp: Optional[str] = None,
) -> Dict[str, Any]:
    """Alias for backwards compatibility."""
    return update_latest_sensor_data(
        soil_moisture=soil_moisture,
        temperature=temperature,
        humidity=humidity,
        pump_status=pump_status,
        device_id="harvex-node-1",
        timestamp=timestamp,
    )


def get_pending_pump_command() -> Dict[str, Any]:
    """Retrieve the current pending pump command for NodeMCU ESP8266."""
    return pending_pump_command


def set_pending_pump_command(
    pump_command: str,
    max_runtime_seconds: int = 30,
    display_message: str = "",
) -> Dict[str, Any]:
    """Set manual pending pump command from web dashboard."""
    global manual_pump_override
    cmd = str(pump_command).strip().lower()
    is_on = cmd == "on"
    pending_pump_command["pump_command"] = "on" if is_on else "off"
    pending_pump_command["max_runtime_seconds"] = int(max_runtime_seconds) if is_on else 0
    pending_pump_command["display_message"] = display_message or ("Web Pump ON" if is_on else "Web Pump OFF")
    manual_pump_override = True

    # Reflect in current state
    latest_sensor_data["pump_status"] = pending_pump_command["pump_command"]
    return pending_pump_command


def clear_manual_pump_override() -> None:
    """Clear manual override so automatic decisions can take effect."""
    global manual_pump_override
    manual_pump_override = False


def is_manual_pump_override_active() -> bool:
    """Check if manual override is currently set."""
    return manual_pump_override


def add_in_memory_pump_history(entry: Dict[str, Any]) -> None:
    """Append event to in-memory history list."""
    in_memory_pump_history.insert(0, entry)
    if len(in_memory_pump_history) > 100:
        in_memory_pump_history.pop()


def get_in_memory_pump_history(limit: int = 50) -> List[Dict[str, Any]]:
    """Get in-memory history list."""
    return in_memory_pump_history[:limit]
