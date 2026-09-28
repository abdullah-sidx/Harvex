import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

DB_PATH = os.getenv("HARVEX_DB_PATH", os.path.join(os.path.dirname(__file__), "harvex.db"))

_db_lock = threading.Lock()

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn

def init_db() -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
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
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS pump_history (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    action TEXT NOT NULL,
                    triggered_by TEXT NOT NULL,
                    duration_seconds INTEGER NOT NULL
                )
            """)
            conn.commit()
        finally:
            conn.close()

def save_sensor_reading(device_id: str, timestamp: str, soil_moisture_pct: float, temperature_c: float, humidity_pct: float, pump_status: str) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now_iso = datetime.now(timezone.utc).isoformat()
            cursor.execute("""INSERT INTO sensor_history (device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)""", (device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, now_iso))
            cursor.execute("SELECT last_watered FROM latest_sensors WHERE device_id = ?", (device_id,))
            row = cursor.fetchone()
            current_last_watered = row["last_watered"] if row else None
            new_last_watered = timestamp if str(pump_status).lower() == "on" else current_last_watered
            cursor.execute("""INSERT INTO latest_sensors (device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, last_watered, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET timestamp=excluded.timestamp, soil_moisture_pct=excluded.soil_moisture_pct, temperature_c=excluded.temperature_c, humidity_pct=excluded.humidity_pct, pump_status=excluded.pump_status, last_watered=CASE WHEN excluded.pump_status='on' THEN excluded.timestamp ELSE latest_sensors.last_watered END, updated_at=excluded.updated_at""", (device_id, timestamp, soil_moisture_pct, temperature_c, humidity_pct, pump_status, new_last_watered, now_iso))
            conn.commit()
        finally:
            conn.close()

def update_last_watered(device_id: str, last_watered_iso: str) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE latest_sensors SET last_watered=? WHERE device_id=?", (last_watered_iso, device_id))
            conn.commit()
        finally:
            conn.close()

def get_latest_sensor_reading(device_id: str = "harvex-node-1") -> Dict[str, Any]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM latest_sensors WHERE device_id = ?", (device_id,))
            row = cursor.fetchone()
            if row:
                return {"device_id": row["device_id"], "timestamp": row["timestamp"], "soil_moisture_pct": row["soil_moisture_pct"], "temperature_c": row["temperature_c"], "humidity_pct": row["humidity_pct"], "pump_status": row["pump_status"], "last_watered": row["last_watered"]}
            return {"device_id": device_id, "timestamp": datetime.now(timezone.utc).isoformat(), "soil_moisture_pct": 42.0, "temperature_c": 28.5, "humidity_pct": 61.0, "pump_status": "off", "last_watered": None}
        finally:
            conn.close()

def save_disease_detection(disease_class: str, confidence: float, advisory: str, advisory_hi: Optional[str] = None, device_id: str = "harvex-node-1") -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now_iso = datetime.now(timezone.utc).isoformat()
            cursor.execute("""INSERT INTO latest_disease (device_id, disease_class, confidence, advisory, advisory_hi, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET disease_class=excluded.disease_class, confidence=excluded.confidence, advisory=excluded.advisory, advisory_hi=excluded.advisory_hi, updated_at=excluded.updated_at""", (device_id, disease_class, confidence, advisory, advisory_hi, now_iso))
            conn.commit()
        finally:
            conn.close()

def get_latest_disease_detection(device_id: str = "harvex-node-1") -> Dict[str, Any]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM latest_disease WHERE device_id = ?", (device_id,))
            row = cursor.fetchone()
            if row:
                row_keys = row.keys()
                return {"disease_class": row["disease_class"], "confidence": round(row["confidence"], 2), "advisory": row["advisory"], "advisory_hi": row["advisory_hi"] if "advisory_hi" in row_keys and row["advisory_hi"] else None}
            return {"disease_class": "uncertain", "confidence": 0.0, "advisory": "No photo uploaded yet.", "advisory_hi": "अभी तक कोई फोटो अपलोड नहीं की गई है。"}
        finally:
            conn.close()

def get_sensor_history(device_id: str = "harvex-node-1", limit: int = 50) -> List[Dict[str, Any]]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sensor_history WHERE device_id = ? ORDER BY id DESC LIMIT ?", (device_id, limit))
            rows = cursor.fetchall()
            return [{"id": r["id"], "device_id": r["device_id"], "timestamp": r["timestamp"], "soil_moisture_pct": r["soil_moisture_pct"], "temperature_c": r["temperature_c"], "humidity_pct": r["humidity_pct"], "pump_status": r["pump_status"], "created_at": r["created_at"]} for r in rows]
        finally:
            conn.close()

def add_pump_history(id: str, timestamp: str, action: str, triggered_by: str, duration_seconds: int = 30) -> None:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO pump_history (id, timestamp, action, triggered_by, duration_seconds) VALUES (?, ?, ?, ?, ?)", (id, timestamp, action.upper(), triggered_by.upper(), duration_seconds))
            conn.commit()
        finally:
            conn.close()

def get_pump_history(limit: int = 50) -> List[Dict[str, Any]]:
    with _db_lock:
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id, timestamp, action, triggered_by, duration_seconds FROM pump_history ORDER BY timestamp DESC LIMIT ?", (limit,))
            rows = cursor.fetchall()
            return [{"id": row["id"], "timestamp": row["timestamp"], "action": row["action"], "triggered_by": row["triggered_by"], "duration_seconds": row["duration_seconds"]} for row in rows]
        finally:
            conn.close()
