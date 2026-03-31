import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
import json
import os
import logging
import re
import random
from datetime import datetime
from contextlib import contextmanager
from typing import Optional, Dict, List, Any, Union, Tuple
from dotenv import load_dotenv

load_dotenv(override=True)

# Set up logging
logger = logging.getLogger(__name__)

# Global connection pool
_db_pool: Optional[ThreadedConnectionPool] = None
INIT_DB_ADVISORY_LOCK_KEY = 2026033001

def get_pool() -> ThreadedConnectionPool:
    """Lazy initialization of the database connection pool."""
    global _db_pool
    if _db_pool is None:
        try:
            _db_pool = ThreadedConnectionPool(
                minconn=1,
                maxconn=20,
                host=os.getenv("DB_HOST", "localhost"),
                database=os.getenv("DB_NAME", "postgres"),
                user=os.getenv("DB_USER", "postgres"),
                password=os.getenv("DB_PASS", ""),
                port=os.getenv("DB_PORT", "5432")
            )
            logger.info("Database connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}")
            raise
    return _db_pool

class ContentNormalizer:
    """Handles canonicalization and normalization of content patterns and topics."""
    
    PATTERN_TYPE_ALIASES = {
        "top_list": "top_list", "list": "top_list", "список": "top_list", "топ": "top_list", "top": "top_list",
        "opinion_take": "opinion_take", "opinion": "opinion_take", "мнение": "opinion_take", 
        "спорное мнение": "opinion_take", "контрарное мнение": "opinion_take",
        "hidden_gems": "hidden_gems", "hidden gem": "hidden_gems", "скрытая находка": "hidden_gems", 
        "скрытые места": "hidden_gems", "недооцененные места": "hidden_gems",
        "comparison": "comparison", "compare": "comparison", "сравнение": "comparison",
        "route_story": "route_story", "route": "route_story", "маршрут": "route_story", "история маршрута": "route_story",
        "mistakes": "mistakes", "mistake": "mistakes", "ошибки": "mistakes", "ошибка": "mistakes",
        "problem_solution": "problem_solution", "problem-solution": "problem_solution", 
        "решение проблемы": "problem_solution", "проблема-решение": "problem_solution",
        "experience_review": "experience_review", "review": "experience_review", "обзор опыта": "experience_review", 
        "личный обзор": "experience_review", "other": "other",
    }

    FORMAT_TYPE_ALIASES = {
        "список": "list", "топ": "list", "list": "list", "маршрут": "route", "route": "route",
        "сравнение": "comparison", "comparison": "comparison", "спорное мнение": "opinion", 
        "мнение": "opinion", "opinion": "opinion", "разбор ошибок": "mistakes", 
        "ошибки": "mistakes", "mistakes": "mistakes", "решение проблемы": "problem_solution", 
        "problem_solution": "problem_solution", "обзор опыта": "experience_review", "experience_review": "experience_review",
    }

    TOPIC_FAMILY_ALIASES = {
        "дешевые_страны": "budget_destinations", "дешевые_направления": "budget_destinations", 
        "бюджетные_путешествия": "budget_destinations", "бюджет": "budget_destinations",
        "недооцененные_места": "underrated_destinations", "недооцененные_направления": "underrated_destinations", 
        "скрытые_места": "underrated_destinations", "скрытые_находки": "underrated_destinations",
        "никуда_не_деньтесь": "destination_recommendations", "куда_поехать": "destination_recommendations", 
        "топ_мест": "destination_recommendations", "рекомендации": "destination_recommendations",
        "топ_мест_по_сезону": "seasonal_destination_list", "сезон": "seasonal_destination_list",
        "маршрут_по_стране": "country_route", "роудтрип": "country_route", 
        "путешествие_по_стране": "country_route", "маршрут": "country_route",
        "ошибки_туристов": "travel_mistakes", "ошибки_в_путешествии": "travel_mistakes", "ошибки": "travel_mistakes",
        "сравнение_направлений": "destination_comparison", "сравнение": "destination_comparison",
        "эмиграция": "relocation", "релокация": "relocation", "переезд": "relocation",
        "имиграция": "relocation", "иммиграция": "relocation", "внж": "relocation", "паспорт": "relocation",
        "туризм": "tourism", "отдых": "tourism", "путешествия": "tourism",
        "качество_жисни": "lifestyle", "лайфстайл": "lifestyle",
        "финансы": "finance", "деньги": "finance", "экономия": "finance",
    }

    @staticmethod
    def normalize_text(value: Any) -> str:
        if value is None: return ""
        text = str(value).strip().lower().replace("ё", "е")
        return re.sub(r"\s+", " ", text)

    @staticmethod
    def slugify(value: Any) -> str:
        text = ContentNormalizer.normalize_text(value)
        text = re.sub(r"[^a-z0-9а-я ]+", " ", text)
        return re.sub(r"\s+", "_", text).strip("_")

    @classmethod
    def canonical_pattern_type(cls, value: Optional[str]) -> str:
        if value is None: return "other"
        key = cls.slugify(value)
        return cls.PATTERN_TYPE_ALIASES.get(key, key or "other")

    @classmethod
    def canonical_format_type(cls, value: Optional[str]) -> str:
        if value is None: return "other"
        key = cls.slugify(value)
        return cls.FORMAT_TYPE_ALIASES.get(key, key or "other")

    @classmethod
    def canonical_topic_family(cls, value: str, topic_angle: Optional[str] = None, hook_type: Optional[str] = None) -> str:
        key = cls.slugify(value)
        if key in cls.TOPIC_FAMILY_ALIASES:
            return cls.TOPIC_FAMILY_ALIASES[key]

        angle_key = cls.slugify(topic_angle)
        hook_key = cls.slugify(hook_type)

        if any(x in key for x in ["эмиграц", "переезд", "релокац", "иммиграц", "имиграц", "внж", "паспорт"]): return "relocation"
        if any(x in key for x in ["апрел", "ма", "июн", "сезон"]): return "seasonal_destination_list"
        if "ошиб" in key or "ошиб" in angle_key: return "travel_mistakes"
        if "маршрут" in key or "роуд" in key or "маршрут" in angle_key: return "country_route"
        if any(x in key for x in ["сравнен", "вместо"]) or "comparison" in hook_key: return "destination_comparison"
        if any(x in key for x in ["недооцен", "скрыт"]) or "не слышал" in angle_key: return "underrated_destinations"
        if "дешев" in key or "бюджет" in key: return "budget_destinations"
        if any(x in key for x in ["туризм", "отдых", "путешеств"]): return "tourism"
        if any(x in key for x in ["куда", "поехать", "топ"]): return "destination_recommendations"
        
        if "_" in key and len(key) > 20:
             first_word = key.split("_")[0]
             if len(first_word) > 3: return first_word
             
        return key or "general_travel_topic"

    @staticmethod
    def sequence_signature(sequence_logic: List[str]) -> str:
        if not isinstance(sequence_logic, list): return "no_sequence"
        normalized = []
        for item in sequence_logic[:8]:
            token = ContentNormalizer.slugify(item)
            token = re.sub(r"\d+", "", token)
            token = re.sub(r"_+", "_", token).strip("_")
            if token: normalized.append(token)
        return "|".join(normalized) or "no_sequence"

    @classmethod
    def normalize_structure_data(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        data = data or {}
        shape = data.get("content_shape") or {}
        pattern = cls.canonical_pattern_type(data.get("pattern_type"))
        fmt = cls.canonical_format_type(shape.get("format_type") or pattern)
        sig = cls.sequence_signature(shape.get("sequence_logic", []))
        
        fingerprint = "::".join([
            pattern, 
            fmt, 
            cls.normalize_text(data.get("narrator_role")) or "no_role",
            cls.normalize_text(data.get("hook_style")) or "no_hook", 
            sig
        ])

        return {
            **data, 
            "pattern_type": pattern, 
            "narrator_role": data.get("narrator_role") or "Не определен",
            "hook_style": data.get("hook_style") or "Не определен", 
            "content_shape": {**shape, "format_type": fmt},
            "canonical_pattern_key": pattern, 
            "structure_fingerprint": fingerprint
        }

    @classmethod
    def normalize_topic_data(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        data = data or {}
        family = cls.canonical_topic_family(
            data.get("topic_family") or data.get("topic_cluster") or data.get("topic_short") or "",
            topic_angle=data.get("topic_angle"), 
            hook_type=data.get("hook_type")
        )
        # Heuristics from normalize_db.py
        country = data.get('country')
        if not country:
            text = (data.get('topic_short') or "") + " " + (data.get('topic_family') or "")
            countries = ["Россия", "Турция", "Европа", "Азия", "США", "Таиланд", "Бали"]
            for c in countries:
                if c.lower() in text.lower():
                    country = c
                    break
            if not country: country = "Global"

        hunt_stage = data.get('hunt_stage')
        if not hunt_stage:
            text = (data.get('topic_short') or "") + " " + (data.get('topic_angle') or "")
            if any(x in text.lower() for x in ["как", "зачем", "почему", "проблема"]):
                hunt_stage = "Awareness"
            elif any(x in text.lower() for x in ["топ", "лучшие", "сравнение"]):
                hunt_stage = "Consideration"
            else:
                hunt_stage = "Solution"

        return {
            **data, 
            "topic_family": data.get("topic_family") or family, 
            "canonical_topic_family": family,
            "country": country,
            "hunt_stage": hunt_stage
        }


class DBConnection:
    """Context manager for PostgreSQL database connections and cursors from a pool."""
    def __init__(self, commit: bool = True, use_dict_cursor: bool = False):
        self.commit = commit
        self.use_dict_cursor = use_dict_cursor
        self.pool = get_pool()
        self.conn = None
        self.cursor = None

    def __enter__(self):
        try:
            self.conn = self.pool.getconn()
            factory = RealDictCursor if self.use_dict_cursor else None
            self.cursor = self.conn.cursor(cursor_factory=factory)
            return self.cursor
        except Exception as e:
            logger.error(f"Database connection error: {e}")
            if self.conn:
                self.pool.putconn(self.conn)
            raise

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type:
                logger.error(f"Transaction rollback due to: {exc_val}")
                self.conn.rollback()
            elif self.commit:
                self.conn.commit()
        finally:
            if self.cursor:
                self.cursor.close()
            if self.conn:
                self.pool.putconn(self.conn)

def _json_dumps(data: Any) -> Any:
    """Helper to dump JSON only if it's a dict or list."""
    return json.dumps(data, ensure_ascii=False) if isinstance(data, (dict, list)) else data

def get_db_connection():
    """Backward-compatible direct connection helper for legacy modules."""
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "postgres"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASS", ""),
        port=os.getenv("DB_PORT", "5432")
    )

def _upsert(table: str, conflict_on: Union[str, Tuple[str, ...]], **kwargs) -> None:
    """Generic helper for INSERT ... ON CONFLICT DO UPDATE."""
    fields = list(kwargs.keys())
    placeholders = ["%s"] * len(fields)
    
    # Handle multiple conflict columns
    if isinstance(conflict_on, str):
        conflict_str = conflict_on
    else:
        conflict_str = ", ".join(conflict_on)
        
    update_set = ", ".join([f"{k} = EXCLUDED.{k}" for k in fields if k not in conflict_on])
    
    sql = f"""
        INSERT INTO {table} ({', '.join(fields)}) 
        VALUES ({', '.join(placeholders)}) 
        ON CONFLICT ({conflict_str}) 
        DO UPDATE SET {update_set}
    """
    with DBConnection() as cursor:
        cursor.execute(sql, list(kwargs.values()))

# --- Public API Functions ---

def init_db() -> None:
    """Initializes the database schema."""
    tables = [
        """CREATE TABLE IF NOT EXISTS clients (
            id SERIAL PRIMARY KEY, name TEXT UNIQUE, niche TEXT, brand_voice TEXT,
            product_info TEXT, target_audience TEXT, auto_generate BOOLEAN DEFAULT FALSE,
            monthly_limit INTEGER DEFAULT 30, target_duration_seconds INTEGER DEFAULT 50,
            target_duration_min_seconds INTEGER DEFAULT 50, target_duration_max_seconds INTEGER DEFAULT 50,
            broll_interval_seconds NUMERIC(4,1) DEFAULT 3.0,
            broll_timing_mode TEXT DEFAULT 'semantic_pause',
            broll_pacing_profile TEXT DEFAULT 'balanced',
            broll_pause_threshold_seconds NUMERIC(3,2) DEFAULT 0.45,
            broll_coverage_percent NUMERIC(4,1) DEFAULT 35.0,
            broll_semantic_relevance_priority TEXT DEFAULT 'balanced',
            broll_product_clip_policy TEXT DEFAULT 'contextual',
            broll_generator_model TEXT DEFAULT 'bytedance/v1-pro-text-to-video',
            product_media_assets JSONB DEFAULT '[]'::jsonb, product_keyword TEXT, product_video_url TEXT, tts_provider TEXT DEFAULT 'minimax', tts_voice_id TEXT,
            elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY',
            subtitles_enabled BOOLEAN DEFAULT FALSE,
            subtitle_mode TEXT DEFAULT 'word_by_word',
            subtitle_style_preset TEXT DEFAULT 'classic',
            subtitle_font_family TEXT DEFAULT 'pt_sans',
            subtitle_font_color TEXT DEFAULT '#FFFFFF',
            subtitle_font_weight INTEGER DEFAULT 700,
            subtitle_outline_color TEXT DEFAULT '#111111',
            subtitle_outline_width NUMERIC(4,1) DEFAULT 3.0,
            subtitle_margin_v INTEGER DEFAULT 140,
            auto_generate_final_videos BOOLEAN DEFAULT FALSE,
            daily_final_video_limit INTEGER DEFAULT 3,
            monthly_final_video_limit INTEGER DEFAULT 30,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS topic_configs (
            topic_id TEXT PRIMARY KEY, client_id INTEGER REFERENCES clients(id),
            niche TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS processed_content (
            id SERIAL PRIMARY KEY, job_id TEXT UNIQUE, client_id INTEGER REFERENCES clients(id),
            niche TEXT, target_product_info TEXT, reels_url TEXT, transcript TEXT,
            audit_json JSONB, scenario_json JSONB, topic_card_id INTEGER, 
            structure_card_id INTEGER, final_video_url TEXT, viral_score INTEGER,
            word_count INTEGER, duration_seconds INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS topic_cards (
            id SERIAL PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            source_content_id INTEGER REFERENCES processed_content(id) ON DELETE SET NULL,
            topic_short TEXT, topic_family TEXT, canonical_topic_family TEXT, topic_cluster TEXT,
            topic_angle TEXT, promise TEXT, pain_point TEXT, proof_type TEXT, cta_type TEXT,
            country TEXT, hunt_stage TEXT,
            metadata_json JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (client_id, topic_short, topic_angle)
        )""",
        """CREATE TABLE IF NOT EXISTS structure_cards (
            id SERIAL PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            source_content_id INTEGER REFERENCES processed_content(id) ON DELETE SET NULL,
            pattern_type TEXT, canonical_pattern_key TEXT, structure_fingerprint TEXT,
            narrator_role TEXT, hook_style TEXT, core_thesis TEXT, format_type TEXT,
            item_count INTEGER, sequence_logic JSONB, integration_style JSONB,
            reusable_slots JSONB, forbidden_drifts JSONB, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (client_id, pattern_type, core_thesis, format_type)
        )""",
        """CREATE TABLE IF NOT EXISTS topic_structure_pairs (
            id SERIAL PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            topic_card_id INTEGER REFERENCES topic_cards(id) ON DELETE CASCADE,
            structure_card_id INTEGER REFERENCES structure_cards(id) ON DELETE CASCADE,
            source_content_id INTEGER REFERENCES processed_content(id) ON DELETE SET NULL,
            pair_count INTEGER DEFAULT 1, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (client_id, topic_card_id, structure_card_id)
        )""",
        """CREATE TABLE IF NOT EXISTS generated_scenarios (
            id SERIAL PRIMARY KEY, job_id TEXT UNIQUE, client_id INTEGER REFERENCES clients(id),
            source_content_id INTEGER REFERENCES processed_content(id) ON DELETE SET NULL,
            topic_card_id INTEGER REFERENCES topic_cards(id) ON DELETE SET NULL,
            structure_card_id INTEGER REFERENCES structure_cards(id) ON DELETE SET NULL,
            niche TEXT, mode TEXT, topic TEXT, angle TEXT, scenario_json JSONB,
            tts_script TEXT, tts_request_text TEXT, tts_audio_path TEXT, tts_audio_duration_seconds NUMERIC(10,3), tts_word_timestamps JSONB, video_keyword_segments JSONB, video_generation_prompts JSONB,
            heygen_audio_asset_id TEXT, heygen_video_id TEXT, heygen_status TEXT, heygen_error TEXT,
            heygen_video_url TEXT, heygen_thumbnail_url TEXT,
            heygen_avatar_id TEXT, heygen_avatar_name TEXT, heygen_look_id TEXT, heygen_look_name TEXT,
            heygen_requested_at TIMESTAMP, heygen_completed_at TIMESTAMP,
            background_audio_tag TEXT DEFAULT 'neutral',
            montage_video_path TEXT, montage_status TEXT, montage_error TEXT, montage_updated_at TIMESTAMP,
            montage_background_audio_name TEXT, montage_background_audio_path TEXT,
            montage_yandex_disk_path TEXT, montage_yandex_public_url TEXT, montage_yandex_status TEXT,
            montage_yandex_error TEXT, montage_yandex_uploaded_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS final_video_jobs (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            scenario_id INTEGER REFERENCES generated_scenarios(id) ON DELETE SET NULL,
            scenario_job_id TEXT,
            status TEXT DEFAULT 'queued',
            current_stage TEXT DEFAULT 'scenario',
            priority INTEGER DEFAULT 100,
            attempt_count INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 6,
            worker_id TEXT,
            last_error TEXT,
            scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            lease_until TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS client_heygen_avatars (
            id SERIAL PRIMARY KEY,
            client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
            avatar_id TEXT NOT NULL,
            avatar_name TEXT NOT NULL,
            folder_name TEXT,
            preview_image_url TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            usage_count INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            last_used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (client_id, avatar_id)
        )""",
        """CREATE TABLE IF NOT EXISTS client_heygen_avatar_looks (
            id SERIAL PRIMARY KEY,
            client_avatar_id INTEGER REFERENCES client_heygen_avatars(id) ON DELETE CASCADE,
            look_id TEXT NOT NULL,
            look_name TEXT NOT NULL,
            preview_image_url TEXT,
            motion_look_id TEXT,
            motion_prompt TEXT,
            motion_type TEXT,
            motion_status TEXT,
            motion_error TEXT,
            motion_updated_at TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            usage_count INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            last_used_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (client_avatar_id, look_id)
        )""",
        # Migration helpers
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_generate BOOLEAN DEFAULT FALSE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_limit INTEGER DEFAULT 30",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_duration_seconds INTEGER DEFAULT 50",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_duration_min_seconds INTEGER DEFAULT 50",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_duration_max_seconds INTEGER DEFAULT 50",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_interval_seconds NUMERIC(4,1) DEFAULT 3.0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_timing_mode TEXT DEFAULT 'semantic_pause'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pacing_profile TEXT DEFAULT 'balanced'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pause_threshold_seconds NUMERIC(3,2) DEFAULT 0.45",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_coverage_percent NUMERIC(4,1) DEFAULT 35.0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_semantic_relevance_priority TEXT DEFAULT 'balanced'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_product_clip_policy TEXT DEFAULT 'contextual'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_generator_model TEXT DEFAULT 'bytedance/v1-pro-text-to-video'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_media_assets JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_keyword TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_video_url TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_voice_id TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitles_enabled BOOLEAN DEFAULT FALSE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_mode TEXT DEFAULT 'word_by_word'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_style_preset TEXT DEFAULT 'classic'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_family TEXT DEFAULT 'pt_sans'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_color TEXT DEFAULT '#FFFFFF'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_weight INTEGER DEFAULT 700",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_outline_color TEXT DEFAULT '#111111'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_outline_width NUMERIC(4,1) DEFAULT 3.0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_margin_v INTEGER DEFAULT 140",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_generate_final_videos BOOLEAN DEFAULT FALSE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS daily_final_video_limit INTEGER DEFAULT 3",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS monthly_final_video_limit INTEGER DEFAULT 30",
        "ALTER TABLE processed_content ADD COLUMN IF NOT EXISTS topic_card_id INTEGER",
        "ALTER TABLE processed_content ADD COLUMN IF NOT EXISTS structure_card_id INTEGER",
        "ALTER TABLE processed_content ADD COLUMN IF NOT EXISTS word_count INTEGER",
        "ALTER TABLE processed_content ADD COLUMN IF NOT EXISTS duration_seconds INTEGER",
        "ALTER TABLE topic_cards ADD COLUMN IF NOT EXISTS country TEXT",
        "ALTER TABLE topic_cards ADD COLUMN IF NOT EXISTS hunt_stage TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS topic_card_id INTEGER REFERENCES topic_cards(id) ON DELETE SET NULL",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS structure_card_id INTEGER REFERENCES structure_cards(id) ON DELETE SET NULL",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_script TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_request_text TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_audio_path TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_audio_duration_seconds NUMERIC(10,3)",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS tts_word_timestamps JSONB",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS video_keyword_segments JSONB",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS video_generation_prompts JSONB",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_audio_asset_id TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_video_id TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_status TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_error TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_video_url TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_thumbnail_url TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_avatar_id TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_avatar_name TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_look_id TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_look_name TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_requested_at TIMESTAMP",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS heygen_completed_at TIMESTAMP",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS background_audio_tag TEXT DEFAULT 'neutral'",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_video_path TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_status TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_error TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_updated_at TIMESTAMP",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_background_audio_name TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_background_audio_path TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_disk_path TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_public_url TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_status TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_error TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS montage_yandex_uploaded_at TIMESTAMP",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS scenario_id INTEGER REFERENCES generated_scenarios(id) ON DELETE SET NULL",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS scenario_job_id TEXT",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued'",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'scenario'",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 100",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 6",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS worker_id TEXT",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS last_error TEXT",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS lease_until TIMESTAMP",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE final_video_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS folder_name TEXT",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS preview_image_url TEXT",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS preview_image_url TEXT",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_look_id TEXT",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_prompt TEXT",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_type TEXT",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_status TEXT",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_error TEXT",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS motion_updated_at TIMESTAMP",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0",
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP"
    ]
    try:
        with DBConnection() as cursor:
            # Serialize schema bootstrap across all services/containers.
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", (INIT_DB_ADVISORY_LOCK_KEY,))
            for sql in tables:
                cursor.execute(sql)
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Init DB failed: {e}")

def save_generated_scenario(job_id: str, **kwargs: Any) -> None:
    for key in ["scenario_json", "tts_word_timestamps", "video_keyword_segments", "video_generation_prompts"]:
        if key in kwargs:
            kwargs[key] = _json_dumps(kwargs[key])
    _upsert("generated_scenarios", "job_id", job_id=job_id, **kwargs)


def get_generated_scenario_by_job_id(job_id: str) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("SELECT * FROM generated_scenarios WHERE job_id = %s", (str(job_id),))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_generated_scenarios_with_kie_tasks(limit: int = 100) -> List[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT *
            FROM generated_scenarios
            WHERE video_generation_prompts IS NOT NULL
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cursor.fetchall() or []
        return [dict(row) for row in rows]

def save_content_data(job_id: str, **kwargs: Any) -> None:
    for key in ["audit_json", "scenario_json"]:
        if key in kwargs:
            kwargs[key] = _json_dumps(kwargs[key])
    _upsert("processed_content", "job_id", job_id=job_id, **kwargs)

def get_processed_content_by_job_id(job_id: str) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("SELECT * FROM processed_content WHERE job_id = %s", (str(job_id),))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_entity_by_id(table: str, entity_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(f"SELECT * FROM {table} WHERE id = %s", (entity_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_topic_card(tid: int) -> Optional[Dict[str, Any]]:
    return get_entity_by_id("topic_cards", tid)

def get_structure_card(sid: int) -> Optional[Dict[str, Any]]:
    return get_entity_by_id("structure_cards", sid)

def save_topic_card(client_id: int, topic_data: Dict[str, Any], source_content_id: Optional[int] = None) -> Optional[int]:
    if not client_id or not topic_data: return None
    t = ContentNormalizer.normalize_topic_data(topic_data)
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            INSERT INTO topic_cards (
                client_id, source_content_id, topic_short, topic_family, canonical_topic_family, topic_cluster, topic_angle,
                promise, pain_point, proof_type, cta_type, country, hunt_stage, metadata_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (client_id, topic_short, topic_angle) DO UPDATE SET
                source_content_id = COALESCE(EXCLUDED.source_content_id, topic_cards.source_content_id),
                topic_family = EXCLUDED.topic_family, 
                canonical_topic_family = EXCLUDED.canonical_topic_family,
                topic_cluster = EXCLUDED.topic_cluster, promise = EXCLUDED.promise, 
                pain_point = EXCLUDED.pain_point, proof_type = EXCLUDED.proof_type,
                cta_type = EXCLUDED.cta_type, 
                country = COALESCE(EXCLUDED.country, topic_cards.country),
                hunt_stage = COALESCE(EXCLUDED.hunt_stage, topic_cards.hunt_stage),
                metadata_json = EXCLUDED.metadata_json
            RETURNING id
        """, (
            client_id, source_content_id, t.get("topic_short") or t.get("topic_cluster") or "Без темы",
            t.get("topic_family"), t.get("canonical_topic_family"), t.get("topic_cluster"),
            t.get("topic_angle") or "Без угла", t.get("promise"), t.get("pain_point"),
            t.get("proof_type"), t.get("cta_type"), t.get("country"), t.get("hunt_stage"), _json_dumps(t)
        ))
        row = cursor.fetchone()
        return row["id"] if row else None

def save_structure_card(client_id: int, data: Dict[str, Any], source_content_id: Optional[int] = None) -> Optional[int]:
    if not client_id or not data: return None
    s = ContentNormalizer.normalize_structure_data(data)
    shape = s.get("content_shape", {})
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            INSERT INTO structure_cards (
                client_id, source_content_id, pattern_type, canonical_pattern_key, structure_fingerprint, 
                narrator_role, hook_style, core_thesis, format_type, item_count, sequence_logic,
                integration_style, reusable_slots, forbidden_drifts
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)
            ON CONFLICT (client_id, pattern_type, core_thesis, format_type) DO UPDATE SET
                source_content_id = COALESCE(EXCLUDED.source_content_id, structure_cards.source_content_id),
                canonical_pattern_key = EXCLUDED.canonical_pattern_key, 
                structure_fingerprint = EXCLUDED.structure_fingerprint, narrator_role = EXCLUDED.narrator_role,
                hook_style = EXCLUDED.hook_style, item_count = EXCLUDED.item_count,
                sequence_logic = EXCLUDED.sequence_logic, integration_style = EXCLUDED.integration_style,
                reusable_slots = EXCLUDED.reusable_slots, forbidden_drifts = EXCLUDED.forbidden_drifts
            RETURNING id
        """, (
            client_id, source_content_id, s.get("pattern_type") or "other", s.get("canonical_pattern_key"),
            s.get("structure_fingerprint"), s.get("narrator_role"), s.get("hook_style"),
            s.get("core_thesis") or "Без тезиса", shape.get("format_type"), shape.get("item_count"),
            _json_dumps(shape.get("sequence_logic", [])), _json_dumps(s.get("integration_style", {})),
            _json_dumps(s.get("reusable_slots", {})), _json_dumps(s.get("forbidden_drifts", []))
        ))
        row = cursor.fetchone()
        return row["id"] if row else None

def link_content_to_cards(job_id: str, topic_card_id: Optional[int] = None, structure_card_id: Optional[int] = None) -> bool:
    if not job_id or (not topic_card_id and not structure_card_id): return False
    updates, values = [], []
    if topic_card_id: updates.append("topic_card_id = %s"); values.append(topic_card_id)
    if structure_card_id: updates.append("structure_card_id = %s"); values.append(structure_card_id)
    values_with_id: List[Any] = list(values)
    values_with_id.append(str(job_id))
    with DBConnection() as cursor:
        cursor.execute(f"UPDATE processed_content SET {', '.join(updates)} WHERE job_id = %s", tuple(values_with_id))
    return True

def save_topic_structure_pair(client_id: int, topic_id: int, str_id: int, source_content_id: Optional[int] = None) -> bool:
    if not all([client_id, topic_id, str_id]): return False
    with DBConnection() as cursor:
        cursor.execute("""
            INSERT INTO topic_structure_pairs (client_id, topic_card_id, structure_card_id, source_content_id, pair_count, updated_at)
            VALUES (%s, %s, %s, %s, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (client_id, topic_card_id, structure_card_id) DO UPDATE SET
                pair_count = topic_structure_pairs.pair_count + 1,
                source_content_id = COALESCE(EXCLUDED.source_content_id, topic_structure_pairs.source_content_id),
                updated_at = CURRENT_TIMESTAMP
        """, (client_id, topic_id, str_id, source_content_id))
    return True

def get_random_entity(table: str, client_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(f"SELECT * FROM {table} WHERE client_id = %s ORDER BY RANDOM() LIMIT 1", (client_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_random_topic_card(cid: int) -> Optional[Dict[str, Any]]:
    return get_random_entity("topic_cards", cid)

def get_random_structure_card(cid: int) -> Optional[Dict[str, Any]]:
    return get_random_entity("structure_cards", cid)

def get_random_topic_family_card(client_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT DISTINCT ON (canonical_topic_family) * FROM topic_cards
            WHERE client_id = %s ORDER BY canonical_topic_family, created_at DESC
        """, (client_id,))
        rows = cursor.fetchall()
        if not rows: return None
        return dict(random.choice(rows))

def get_random_compatible_pair(client_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT t.*, s.id AS structure_id, s.pattern_type, s.narrator_role, s.hook_style, s.core_thesis, 
                   s.format_type, s.item_count, s.sequence_logic, s.integration_style, s.reusable_slots, s.forbidden_drifts
            FROM topic_structure_pairs p JOIN topic_cards t ON t.id = p.topic_card_id
            JOIN structure_cards s ON s.id = p.structure_card_id
            WHERE p.client_id = %s ORDER BY RANDOM() LIMIT 1
        """, (client_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_random_compatible_family_pair(client_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT DISTINCT ON (t.canonical_topic_family, s.canonical_pattern_key)
                t.*, s.id AS structure_id, s.pattern_type, s.canonical_pattern_key, s.structure_fingerprint,
                s.narrator_role, s.hook_style, s.core_thesis, s.format_type, s.item_count, s.sequence_logic,
                s.integration_style, s.reusable_slots, s.forbidden_drifts, p.pair_count
            FROM topic_structure_pairs p JOIN topic_cards t ON t.id = p.topic_card_id
            JOIN structure_cards s ON s.id = p.structure_card_id
            WHERE p.client_id = %s ORDER BY t.canonical_topic_family, s.canonical_pattern_key, p.pair_count DESC, p.updated_at DESC
        """, (client_id,))
        rows = cursor.fetchall()
        if not rows: return None
        return dict(random.choice(rows))

def create_client(name: str, **kwargs: Any) -> int:
    fields = ["name"] + list(kwargs.keys())
    placeholders = ["%s"] * len(fields)
    sql = f"INSERT INTO clients ({', '.join(fields)}) VALUES ({', '.join(placeholders)}) RETURNING id"
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(sql, [name] + list(kwargs.values()))
        row = cursor.fetchone()
        if not row: raise Exception("Failed to create client")
        return row["id"]

def get_client(client_id: Optional[int] = None, name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        if client_id: cursor.execute("SELECT * FROM clients WHERE id = %s", (client_id,))
        else: cursor.execute("SELECT * FROM clients WHERE name = %s", (name,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_client_heygen_avatars(client_id: int) -> List[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT a.*
            FROM client_heygen_avatars a
            WHERE a.client_id = %s
            ORDER BY a.sort_order ASC, a.created_at ASC
        """, (client_id,))
        avatars = [dict(row) for row in cursor.fetchall()]

        for avatar in avatars:
            cursor.execute("""
                SELECT *
                FROM client_heygen_avatar_looks
                WHERE client_avatar_id = %s
                ORDER BY sort_order ASC, created_at ASC
            """, (avatar["id"],))
            avatar["looks"] = [dict(row) for row in cursor.fetchall()]

        return avatars

def replace_client_heygen_avatars(client_id: int, avatars: List[Dict[str, Any]]) -> None:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("DELETE FROM client_heygen_avatar_looks WHERE client_avatar_id IN (SELECT id FROM client_heygen_avatars WHERE client_id = %s)", (client_id,))
        cursor.execute("DELETE FROM client_heygen_avatars WHERE client_id = %s", (client_id,))

        for avatar_index, avatar in enumerate(avatars or []):
            cursor.execute("""
                INSERT INTO client_heygen_avatars (
                    client_id, avatar_id, avatar_name, folder_name, preview_image_url, is_active, usage_count, sort_order, last_used_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                client_id,
                avatar.get("avatar_id"),
                avatar.get("avatar_name") or avatar.get("avatar_id"),
                avatar.get("folder_name"),
                avatar.get("preview_image_url"),
                avatar.get("is_active", True),
                avatar.get("usage_count", 0),
                avatar.get("sort_order", avatar_index),
                avatar.get("last_used_at"),
            ))
            avatar_row = cursor.fetchone()
            if not avatar_row:
                continue

            client_avatar_id = avatar_row["id"]
            for look_index, look in enumerate(avatar.get("looks") or []):
                cursor.execute("""
                    INSERT INTO client_heygen_avatar_looks (
                        client_avatar_id, look_id, look_name, preview_image_url, motion_look_id, motion_prompt, motion_type, motion_status, motion_error, motion_updated_at, is_active, usage_count, sort_order, last_used_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    client_avatar_id,
                    look.get("look_id"),
                    look.get("look_name") or look.get("look_id"),
                    look.get("preview_image_url"),
                    look.get("motion_look_id"),
                    look.get("motion_prompt"),
                    look.get("motion_type"),
                    look.get("motion_status"),
                    look.get("motion_error"),
                    look.get("motion_updated_at"),
                    look.get("is_active", True),
                    look.get("usage_count", 0),
                    look.get("sort_order", look_index),
                    look.get("last_used_at"),
                ))

def choose_next_client_avatar_variant(client_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT *
            FROM client_heygen_avatars
            WHERE client_id = %s AND is_active = TRUE
            ORDER BY usage_count ASC, COALESCE(last_used_at, TIMESTAMP '1970-01-01') ASC, sort_order ASC, created_at ASC
        """, (client_id,))
        avatar_rows = [dict(row) for row in cursor.fetchall()]

        if not avatar_rows:
            return None

        selected_avatar = None
        selected_look = None

        for avatar in avatar_rows:
            cursor.execute("""
                SELECT *
                FROM client_heygen_avatar_looks
                WHERE client_avatar_id = %s AND is_active = TRUE
                ORDER BY
                    CASE
                        WHEN motion_look_id IS NOT NULL AND COALESCE(motion_status, '') IN ('ready', 'completed') THEN 0
                        ELSE 1
                    END ASC,
                    usage_count ASC,
                    COALESCE(last_used_at, TIMESTAMP '1970-01-01') ASC,
                    sort_order ASC,
                    created_at ASC
            """, (avatar["id"],))
            looks = [dict(row) for row in cursor.fetchall()]
            if looks:
                selected_avatar = avatar
                motion_ready_looks = [
                    look for look in looks
                    if look.get("motion_look_id") and str(look.get("motion_status") or "").lower() in {"ready", "completed"}
                ]
                selected_look = random.choice(motion_ready_looks or looks)
                break

        if not selected_avatar:
            return None

        cursor.execute("""
            UPDATE client_heygen_avatars
            SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
            WHERE id = %s
        """, (selected_avatar["id"],))

        if selected_look:
            cursor.execute("""
                UPDATE client_heygen_avatar_looks
                SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (selected_look["id"],))

        return {
            "client_avatar_id": selected_avatar["id"],
            "avatar_id": selected_avatar["avatar_id"],
            "avatar_name": selected_avatar["avatar_name"],
            "folder_name": selected_avatar.get("folder_name"),
            "look": selected_look,
        }

def get_client_monthly_count(client_id: int) -> int:
    """Returns the number of content items processed for this client in the last 30 days."""
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT COUNT(*) as count FROM processed_content 
            WHERE client_id = %s AND created_at > NOW() - INTERVAL '30 days'
        """, (client_id,))
        row = cursor.fetchone()
        return row["count"] if row else 0

def get_client_monthly_final_video_count(client_id: int) -> int:
    """Returns the number of completed final videos for this client in the current calendar month."""
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT COUNT(*) AS count
            FROM generated_scenarios
            WHERE client_id = %s
              AND montage_status = 'completed'
              AND DATE_TRUNC('month', COALESCE(montage_yandex_uploaded_at, montage_updated_at, created_at)) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
            """,
            (client_id,),
        )
        row = cursor.fetchone()
        return row["count"] if row else 0

def get_client_daily_final_video_count(client_id: int) -> int:
    """Returns the number of completed final videos for this client in the current calendar day."""
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT COUNT(*) AS count
            FROM generated_scenarios
            WHERE client_id = %s
              AND montage_status = 'completed'
              AND DATE_TRUNC('day', COALESCE(montage_yandex_uploaded_at, montage_updated_at, created_at)) = DATE_TRUNC('day', CURRENT_TIMESTAMP)
            """,
            (client_id,),
        )
        row = cursor.fetchone()
        return row["count"] if row else 0

def enqueue_final_video_job(
    client_id: int,
    *,
    priority: int = 100,
    current_stage: str = "scenario",
    max_attempts: int = 6,
) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            INSERT INTO final_video_jobs (
                client_id,
                priority,
                current_stage,
                max_attempts,
                status,
                scheduled_for,
                updated_at
            )
            VALUES (%s, %s, %s, %s, 'queued', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
            """,
            (client_id, priority, current_stage, max_attempts),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

def get_final_video_job(job_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("SELECT * FROM final_video_jobs WHERE id = %s", (job_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_generated_scenario_by_id(scenario_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("SELECT * FROM generated_scenarios WHERE id = %s", (scenario_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def requeue_stale_final_video_jobs() -> int:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            UPDATE final_video_jobs
            SET status = 'queued',
                worker_id = NULL,
                lease_until = NULL,
                last_error = COALESCE(last_error, 'Lease expired'),
                updated_at = CURRENT_TIMESTAMP
            WHERE status = 'processing'
              AND lease_until IS NOT NULL
              AND lease_until < CURRENT_TIMESTAMP
            """
        )
        return cursor.rowcount or 0

def claim_next_final_video_job(
    worker_id: str,
    *,
    allowed_stages: List[str],
    lease_seconds: int = 1800,
    per_client_concurrency: int = 1,
) -> Optional[Dict[str, Any]]:
    if not allowed_stages:
        return None

    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            WITH active_jobs AS (
                SELECT client_id, COUNT(*)::int AS active_count
                FROM final_video_jobs
                WHERE status = 'processing'
                GROUP BY client_id
            ),
            candidate AS (
                SELECT j.id
                FROM final_video_jobs j
                LEFT JOIN active_jobs a ON a.client_id = j.client_id
                WHERE j.status = 'queued'
                  AND j.current_stage = ANY(%s)
                  AND j.scheduled_for <= CURRENT_TIMESTAMP
                  AND COALESCE(a.active_count, 0) < %s
                ORDER BY
                  COALESCE(a.active_count, 0) ASC,
                  j.priority DESC,
                  j.scheduled_for ASC,
                  j.created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE final_video_jobs j
            SET status = 'processing',
                worker_id = %s,
                lease_until = CURRENT_TIMESTAMP + (%s * INTERVAL '1 second'),
                started_at = COALESCE(j.started_at, CURRENT_TIMESTAMP),
                attempt_count = j.attempt_count + 1,
                updated_at = CURRENT_TIMESTAMP
            FROM candidate
            WHERE j.id = candidate.id
            RETURNING j.*
            """,
            (allowed_stages, per_client_concurrency, worker_id, lease_seconds),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

def update_final_video_job(job_id: int, **kwargs: Any) -> bool:
    if not kwargs:
        return True
    kwargs["updated_at"] = datetime.utcnow()
    fields = list(kwargs.keys())
    values = list(kwargs.values())
    set_clause = ", ".join([f"{field} = %s" for field in fields])
    with DBConnection() as cursor:
        cursor.execute(f"UPDATE final_video_jobs SET {set_clause} WHERE id = %s", values + [job_id])
    return True

def complete_final_video_job(job_id: int) -> bool:
    with DBConnection() as cursor:
        cursor.execute(
            """
            UPDATE final_video_jobs
            SET status = 'completed',
                lease_until = NULL,
                worker_id = NULL,
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            (job_id,),
        )
    return True

def fail_final_video_job(job_id: int, error_message: str) -> bool:
    with DBConnection() as cursor:
        cursor.execute(
            """
            UPDATE final_video_jobs
            SET status = 'failed',
                lease_until = NULL,
                worker_id = NULL,
                last_error = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            (error_message, job_id),
        )
    return True

def requeue_final_video_job(job_id: int, *, stage: Optional[str] = None, delay_seconds: int = 60, error_message: Optional[str] = None) -> bool:
    with DBConnection() as cursor:
        cursor.execute(
            """
            UPDATE final_video_jobs
            SET status = 'queued',
                current_stage = COALESCE(%s, current_stage),
                worker_id = NULL,
                lease_until = NULL,
                last_error = COALESCE(%s, last_error),
                scheduled_for = CURRENT_TIMESTAMP + (%s * INTERVAL '1 second'),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            """,
            (stage, error_message, delay_seconds, job_id),
        )
    return True

def get_auto_final_video_client_stats() -> List[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT
                c.id,
                c.name,
                c.auto_generate_final_videos,
                c.daily_final_video_limit,
                c.monthly_final_video_limit,
                COALESCE(completed.daily_completed_count, 0) AS daily_final_video_count,
                COALESCE(completed.completed_count, 0) AS monthly_final_video_count,
                COALESCE(open_jobs.open_count, 0) AS open_final_video_jobs
            FROM clients c
            LEFT JOIN (
                SELECT
                    client_id,
                    COUNT(*) FILTER (
                        WHERE DATE_TRUNC('day', COALESCE(montage_yandex_uploaded_at, montage_updated_at, created_at)) = DATE_TRUNC('day', CURRENT_TIMESTAMP)
                    )::int AS daily_completed_count,
                    COUNT(*)::int AS completed_count
                FROM generated_scenarios
                WHERE montage_status = 'completed'
                  AND DATE_TRUNC('month', COALESCE(montage_yandex_uploaded_at, montage_updated_at, created_at)) = DATE_TRUNC('month', CURRENT_TIMESTAMP)
                GROUP BY client_id
            ) completed ON completed.client_id = c.id
            LEFT JOIN (
                SELECT client_id, COUNT(*)::int AS open_count
                FROM final_video_jobs
                WHERE status IN ('queued', 'processing')
                GROUP BY client_id
            ) open_jobs ON open_jobs.client_id = c.id
            WHERE c.auto_generate_final_videos = TRUE
            ORDER BY c.id ASC
            """
        )
        rows = cursor.fetchall() or []
        return [dict(row) for row in rows]

def update_client(client_id: int, **kwargs: Any) -> bool:
    fields, values = list(kwargs.keys()), list(kwargs.values())
    set_clause = ", ".join([f"{f} = %s" for f in fields])
    sql = f"UPDATE clients SET {set_clause} WHERE id = %s"
    with DBConnection() as cursor:
        cursor.execute(sql, values + [client_id])
    return True

def save_topic_config(topic_id: str, client_id: int, niche: Optional[str] = None) -> None:
    with DBConnection() as cursor:
        cursor.execute("""
            INSERT INTO topic_configs (topic_id, client_id, niche, updated_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (topic_id) DO UPDATE SET 
                client_id = EXCLUDED.client_id, niche = COALESCE(EXCLUDED.niche, topic_configs.niche),
                updated_at = CURRENT_TIMESTAMP
        """, (str(topic_id), client_id, niche))

def get_topic_config(topic_id: str) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT tc.*, c.name as client_name, c.product_info, c.brand_voice, c.target_audience
            FROM topic_configs tc JOIN clients c ON tc.client_id = c.id WHERE tc.topic_id = %s
        """, (str(topic_id),))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_references_by_niche(niche="General", client_id=1):
    """
    Fetches all analyzed content for a specific niche and client.
    """
    query = "SELECT * FROM processed_content WHERE client_id = %s AND niche = %s ORDER BY created_at DESC"
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(query, (client_id, niche))
        return cursor.fetchall()

def get_references_by_topic(topic, client_id=1):
    """
    Fetches analyzed content by topic (searching in audit_json).
    """
    query = """
        SELECT * FROM processed_content 
        WHERE client_id = %s 
        AND (audit_json->>'topic_cluster' = %s OR audit_json->>'topic_short' = %s)
        ORDER BY created_at DESC
    """
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(query, (client_id, topic, topic))
        return cursor.fetchall()

def get_references_by_angle(angle, client_id=1):
    """
    Fetches analyzed content by angle (searching in audit_json).
    """
    query = """
        SELECT 
            c.*, 
            cl.name as client_name
        FROM processed_content c
        JOIN clients cl ON c.client_id = cl.id
        WHERE c.client_id = %s 
        AND c.audit_json->>'topic_angle' = %s
        ORDER BY c.created_at DESC
    """
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(query, (client_id, angle))
        return cursor.fetchall()

def get_graph_data(client_id: int) -> Dict[str, Any]:
    """Fetches nodes and edges for the graph visualization."""
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    
    with DBConnection(use_dict_cursor=True) as cursor:
        # 1. Fetch Topic Nodes
        cursor.execute("""
            SELECT id, topic_short as label, topic_family, canonical_topic_family 
            FROM topic_cards WHERE client_id = %s
        """, (client_id,))
        topic_rows = cursor.fetchall()
        for row in topic_rows:
            nodes.append({
                "id": f"topic_{row['id']}",
                "label": row['label'],
                "type": "topic",
                "data": {"family": row['canonical_topic_family']}
            })
            
        # 2. Fetch Structure Nodes
        cursor.execute("""
            SELECT id, pattern_type as label, canonical_pattern_key, narrator_role 
            FROM structure_cards WHERE client_id = %s
        """, (client_id,))
        struct_rows = cursor.fetchall()
        for row in struct_rows:
            nodes.append({
                "id": f"struct_{row['id']}",
                "label": f"{row['label']} ({row['narrator_role']})",
                "type": "structure",
                "data": {"pattern": row['canonical_pattern_key']}
            })
            
        # 3. Fetch Edges (Pairs)
        cursor.execute("""
            SELECT topic_card_id, structure_card_id, pair_count 
            FROM topic_structure_pairs WHERE client_id = %s
        """, (client_id,))
        pair_rows = cursor.fetchall()
        for row in pair_rows:
            edges.append({
                "id": f"e_{row['topic_card_id']}_{row['structure_card_id']}",
                "source": f"topic_{row['topic_card_id']}",
                "target": f"struct_{row['structure_card_id']}",
                "label": str(row['pair_count']),
                "weight": row['pair_count']
            })
            
    return {"nodes": nodes, "edges": edges}

if __name__ == "__main__":
    if os.getenv("INIT_DB", "true").lower() == "true":
        init_db()
