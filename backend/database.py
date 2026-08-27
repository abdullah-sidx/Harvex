import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

DB_PATH = os.getenv("HARVEX_DB_PATH", os.path.join(os.path.dirname(__file__), "harvex.db"))


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Initialize database tables for sensors, device state, and disease results."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Table: Sensor telemetry historical log
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sensor_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            soil_moisture_pct REAL NOT NULL,
            temperature_c REAL NOT NULL,
            humidity_pct REAL NOT NULL,
            pump_status TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # Table: Latest sensor reading per device
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS latest_sensors (
            device_id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            soil_moisture_pct REAL NOT NULL,
            temperature_c REAL NOT NULL,
            humidity_pct REAL NOT NULL,
            pump_status TEXT NOT NULL,
            last_watered TEXT,
            updated_at TEXT NOT NULL
        )
    """)

    # Table: Latest disease detection result
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS latest_disease (
            device_id TEXT PRIMARY KEY,
            disease_class TEXT NOT NULL,
            confidence REAL NOT NULL,
            advisory TEXT NOT NULL,
            advisory_hi TEXT,
            updated_at TEXT NOT NULL
        )
    """)
    try:
        cursor.execute("ALTER TABLE latest_disease ADD COLUMN advisory_hi TEXT")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()


def save_sensor_reading(
    device_id: str,
    timestamp: str,
    soil_moisture_pct: float,
    temperature_c: float,
    humidity_pct: float,
    pump_status: str
) -> None:
    """Store sensor reading in history and update latest snapshot for device_id."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Insert into history table
    cursor.execute("""
        INSERT INTO sensor_history (
            device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, now_iso))

    # 2. Check existing record in latest_sensors
    cursor.execute("SELECT last_watered FROM latest_sensors WHERE device_id = ?", (device_id,))
    row = cursor.fetchone()
    current_last_watered = row["last_watered"] if row else None

    # If pump is currently on, update last_watered timestamp
    new_last_watered = timestamp if pump_status.lower() == "on" else current_last_watered

    # 3. Upsert latest sensor snapshot
    cursor.execute("""
        INSERT INTO latest_sensors (
            device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, last_watered, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
            timestamp = excluded.timestamp,
            soil_moisture_pct = excluded.soil_moisture_pct,
            temperature_c = excluded.temperature_c,
            humidity_pct = excluded.humidity_pct,
            pump_status = excluded.pump_status,
            last_watered = CASE
                WHEN excluded.pump_status = 'on' THEN excluded.timestamp
                ELSE latest_sensors.last_watered
            END,
            updated_at = excluded.updated_at
    """, (device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, new_last_watered, now_iso))

    conn.commit()
    conn.close()


def update_last_watered(device_id: str, last_watered_iso: str) -> None:
    """Explicitly update last_watered timestamp for a device."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE latest_sensors
        SET last_watered = ?
        WHERE device_id = ?
    """, (last_watered_iso, device_id))
    conn.commit()
    conn.close()


def get_latest_sensor_reading(device_id: str = "harvex-node-1") -> Dict[str, Any]:
    """Retrieve the latest sensor snapshot for a device, or default mock if not yet posted."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM latest_sensors WHERE device_id = ?", (device_id,))
    row = cursor.fetchone()
    conn.close()

    if row:
        return {
            "device_id": row["device_id"],
            "timestamp": row["timestamp"],
            "soil_moisture_pct": row["soil_moisture_pct"],
            "temperature_c": row["temperature_c"],
            "humidity_pct": row["humidity_pct"],
            "pump_status": row["pump_status"],
            "last_watered": row["last_watered"],
        }
    
    # Sensible baseline default if no reading has been posted yet
    return {
        "device_id": device_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "soil_moisture_pct": 42.0,
        "temperature_c": 28.5,
        "humidity_pct": 61.0,
        "pump_status": "off",
        "last_watered": None,
    }


def save_disease_detection(
    disease_class: str,
    confidence: float,
    advisory: str,
    advisory_hi: Optional[str] = None,
    device_id: str = "harvex-node-1"
) -> None:
    """Save the latest disease detection result with optional Hindi advisory."""
    conn = get_db_connection()
    cursor = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()

    cursor.execute("""
        INSERT INTO latest_disease (device_id, disease_class, confidence, advisory, advisory_hi, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
            disease_class = excluded.disease_class,
            confidence = excluded.confidence,
            advisory = excluded.advisory,
            advisory_hi = excluded.advisory_hi,
            updated_at = excluded.updated_at
    """, (device_id, disease_class, confidence, advisory, advisory_hi, now_iso))

    conn.commit()
    conn.close()


def get_latest_disease_detection(device_id: str = "harvex-node-1") -> Dict[str, Any]:
    """Retrieve the latest disease detection result, or fallback default."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM latest_disease WHERE device_id = ?", (device_id,))
    row = cursor.fetchone()
    conn.close()

    if row:
        row_keys = row.keys()
        return {
            "disease_class": row["disease_class"],
            "confidence": round(row["confidence"], 2),
            "advisory": row["advisory"],
            "advisory_hi": row["advisory_hi"] if "advisory_hi" in row_keys and row["advisory_hi"] else None
        }

    # Contract default when no leaf photo has been uploaded yet
    return {
        "disease_class": "uncertain",
        "confidence": 0.0,
        "advisory": "No photo uploaded yet.",
        "advisory_hi": "अभी तक कोई फोटो अपलोड नहीं की गई है।"
    }


def get_sensor_history(device_id: str = "harvex-node-1", limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve recent sensor readings history for a device."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM sensor_history
        WHERE device_id = ?
        ORDER BY id DESC
        LIMIT ?
    """, (device_id, limit))
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "device_id": r["device_id"],
            "timestamp": r["timestamp"],
            "soil_moisture_pct": r["soil_moisture_pct"],
            "temperature_c": r["temperature_c"],
            "humidity_pct": r["humidity_pct"],
            "pump_status": r["pump_status"],
            "created_at": r["created_at"]
        }
        for r in rows
    ]
