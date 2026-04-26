import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
import json
import os
import logging
import re
import random
import secrets
import hashlib
from datetime import datetime
from contextlib import contextmanager
from typing import Optional, Dict, List, Any, Union, Tuple, Set
from dotenv import load_dotenv

load_dotenv(override=True)

# Set up logging
logger = logging.getLogger(__name__)

# Global connection pool
_db_pool: Optional[ThreadedConnectionPool] = None
INIT_DB_ADVISORY_LOCK_KEY = 2026033001
AVATAR_RR_LOCK_BASE_KEY = 2026033100

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
    PLACEHOLDER_PREFIXES = (
        "не определ",
        "не указан",
        "не указана",
        "не указано",
        "undefined",
        "none",
        "null",
        "нет данных",
        "без данных",
    )
    
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

    @classmethod
    def is_placeholder(cls, value: Any) -> bool:
        text = cls.normalize_text(value)
        if not text:
            return True
        return any(text.startswith(prefix) for prefix in cls.PLACEHOLDER_PREFIXES)

    @classmethod
    def clean_text_field(cls, value: Any) -> Optional[str]:
        if cls.is_placeholder(value):
            return None
        return str(value).strip()

    @staticmethod
    def slugify(value: Any) -> str:
        text = ContentNormalizer.normalize_text(value)
        text = re.sub(r"[^a-z0-9а-я ]+", " ", text)
        return re.sub(r"\s+", "_", text).strip("_")

    @classmethod
    def canonical_pattern_type(cls, value: Optional[str]) -> str:
        if cls.is_placeholder(value): return "other"
        key = cls.slugify(value)
        return cls.PATTERN_TYPE_ALIASES.get(key, key or "other")

    @classmethod
    def canonical_format_type(cls, value: Optional[str]) -> str:
        if cls.is_placeholder(value): return "other"
        key = cls.slugify(value)
        return cls.FORMAT_TYPE_ALIASES.get(key, key or "other")

    @classmethod
    def canonical_topic_family(cls, value: str, topic_angle: Optional[str] = None, hook_type: Optional[str] = None) -> str:
        if cls.is_placeholder(value):
            return "general_travel_topic"
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
        clean_pattern = cls.clean_text_field(data.get("pattern_type"))
        pattern = cls.canonical_pattern_type(clean_pattern)
        clean_format = cls.clean_text_field(shape.get("format_type")) or pattern
        fmt = cls.canonical_format_type(clean_format)
        sig = cls.sequence_signature(shape.get("sequence_logic", []))
        narrator_role = cls.clean_text_field(data.get("narrator_role"))
        hook_style = cls.clean_text_field(data.get("hook_style"))
        core_thesis = cls.clean_text_field(data.get("core_thesis"))
        
        fingerprint = "::".join([
            pattern, 
            fmt, 
            cls.normalize_text(narrator_role) or "no_role",
            cls.normalize_text(hook_style) or "no_hook", 
            sig
        ])

        return {
            **data, 
            "pattern_type": pattern, 
            "narrator_role": narrator_role,
            "hook_style": hook_style,
            "core_thesis": core_thesis,
            "content_shape": {**shape, "format_type": fmt},
            "canonical_pattern_key": pattern, 
            "structure_fingerprint": fingerprint
        }

    @classmethod
    def normalize_topic_data(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        data = data or {}
        topic_short = cls.clean_text_field(data.get("topic_short"))
        topic_cluster = cls.clean_text_field(data.get("topic_cluster")) or topic_short
        topic_family = cls.clean_text_field(data.get("topic_family")) or topic_cluster or topic_short
        topic_angle = cls.clean_text_field(data.get("topic_angle"))
        promise = cls.clean_text_field(data.get("promise"))
        pain_point = cls.clean_text_field(data.get("pain_point"))
        proof_type = cls.clean_text_field(data.get("proof_type"))
        cta_type = cls.clean_text_field(data.get("cta_type"))
        family = cls.canonical_topic_family(
            topic_family or "",
            topic_angle=topic_angle, 
            hook_type=data.get("hook_type")
        )
        # Heuristics from normalize_db.py
        country = cls.clean_text_field(data.get('country'))
        if not country:
            text = (topic_short or "") + " " + (topic_family or "")
            countries = ["Россия", "Турция", "Европа", "Азия", "США", "Таиланд", "Бали"]
            for c in countries:
                if c.lower() in text.lower():
                    country = c
                    break
            if not country: country = "Global"

        hunt_stage = cls.clean_text_field(data.get('hunt_stage'))
        if not hunt_stage:
            text = (topic_short or "") + " " + (topic_angle or "")
            if any(x in text.lower() for x in ["как", "зачем", "почему", "проблема"]):
                hunt_stage = "Awareness"
            elif any(x in text.lower() for x in ["топ", "лучшие", "сравнение"]):
                hunt_stage = "Consideration"
            else:
                hunt_stage = "Solution"

        return {
            **data, 
            "topic_short": topic_short,
            "topic_cluster": topic_cluster or topic_short,
            "topic_family": topic_family or family,
            "canonical_topic_family": family,
            "topic_angle": topic_angle,
            "promise": promise,
            "pain_point": pain_point,
            "proof_type": proof_type,
            "cta_type": cta_type,
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
            broll_timing_mode TEXT DEFAULT 'coverage_percent',
            broll_pacing_profile TEXT DEFAULT 'balanced',
            broll_pause_threshold_seconds NUMERIC(3,2) DEFAULT 0.45,
            broll_coverage_percent NUMERIC(4,1) DEFAULT 55.0,
            broll_semantic_relevance_priority TEXT DEFAULT 'balanced',
            broll_product_clip_policy TEXT DEFAULT 'contextual',
            broll_generator_model TEXT DEFAULT 'veo3_lite',
            product_media_assets JSONB DEFAULT '[]'::jsonb, product_keyword TEXT, product_video_url TEXT, tts_provider TEXT DEFAULT 'minimax', tts_voice_id TEXT,
            elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY',
            tts_silence_trim_min_duration_seconds NUMERIC(4,2) DEFAULT 0.35,
            tts_silence_trim_threshold_db NUMERIC(5,1) DEFAULT -45.0,
            tts_silence_trim_enabled BOOLEAN DEFAULT TRUE,
            tts_sentence_trim_enabled BOOLEAN DEFAULT FALSE,
            tts_sentence_trim_min_gap_seconds NUMERIC(4,2) DEFAULT 0.30,
            tts_sentence_trim_keep_gap_seconds NUMERIC(4,2) DEFAULT 0.10,
            tts_pronunciation_overrides JSONB DEFAULT '[]'::jsonb,
            subtitles_enabled BOOLEAN DEFAULT FALSE,
            subtitle_mode TEXT DEFAULT 'word_by_word',
            subtitle_style_preset TEXT DEFAULT 'classic',
            subtitle_font_family TEXT DEFAULT 'pt_sans',
            subtitle_font_color TEXT DEFAULT '#FFFFFF',
            subtitle_font_weight INTEGER DEFAULT 700,
            subtitle_outline_color TEXT DEFAULT '#111111',
            subtitle_outline_width NUMERIC(4,1) DEFAULT 3.0,
            subtitle_margin_v INTEGER DEFAULT 140,
            subtitle_margin_percent INTEGER DEFAULT 11,
            auto_generate_final_videos BOOLEAN DEFAULT FALSE,
            daily_final_video_limit INTEGER DEFAULT 3,
            monthly_final_video_limit INTEGER DEFAULT 30,
            learned_rules_scenario TEXT,
            learned_rules_visual TEXT,
            learned_rules_video TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS topic_configs (
            topic_id TEXT PRIMARY KEY, client_id INTEGER REFERENCES clients(id),
            niche TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        """CREATE TABLE IF NOT EXISTS telegram_user_access (
            id SERIAL PRIMARY KEY,
            telegram_user_id BIGINT UNIQUE NOT NULL,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at TIMESTAMP,
            approved_by BIGINT,
            rejected_at TIMESTAMP,
            rejected_by BIGINT,
            notes TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK (status IN ('pending', 'approved', 'rejected'))
        )""",
        "CREATE INDEX IF NOT EXISTS idx_telegram_user_access_status ON telegram_user_access(status)",
        """CREATE TABLE IF NOT EXISTS telegram_web_auth_requests (
            id SERIAL PRIMARY KEY,
            request_id TEXT UNIQUE NOT NULL,
            nonce TEXT NOT NULL,
            telegram_user_id BIGINT,
            status TEXT NOT NULL DEFAULT 'pending',
            redirect_path TEXT NOT NULL DEFAULT '/',
            session_token_hash TEXT,
            session_expires_at TIMESTAMP,
            approved_at TIMESTAMP,
            used_at TIMESTAMP,
            expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '20 minutes'),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK (status IN ('pending', 'approved', 'used', 'expired', 'cancelled'))
        )""",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_auth_requests_status ON telegram_web_auth_requests(status)",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_auth_requests_expires ON telegram_web_auth_requests(expires_at)",
        """CREATE TABLE IF NOT EXISTS telegram_web_sessions (
            id SERIAL PRIMARY KEY,
            session_token_hash TEXT UNIQUE NOT NULL,
            telegram_user_id BIGINT NOT NULL,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            expires_at TIMESTAMP NOT NULL,
            revoked_at TIMESTAMP,
            last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )""",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_sessions_user ON telegram_web_sessions(telegram_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_sessions_expires ON telegram_web_sessions(expires_at)",
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
            generation_source TEXT DEFAULT 'manual',
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
            feedback_rating TEXT,
            feedback_comment TEXT,
            feedback_categories TEXT,
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
            tts_provider TEXT DEFAULT 'minimax',
            tts_voice_id TEXT,
            elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY',
            tts_chars_per_minute NUMERIC(10,2),
            tts_calibrated_at TIMESTAMP,
            tts_calibration_error TEXT,
            tts_calibration_samples_json JSONB,
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
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_timing_mode TEXT DEFAULT 'coverage_percent'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pacing_profile TEXT DEFAULT 'balanced'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_pause_threshold_seconds NUMERIC(3,2) DEFAULT 0.45",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_coverage_percent NUMERIC(4,1) DEFAULT 55.0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_semantic_relevance_priority TEXT DEFAULT 'balanced'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_product_clip_policy TEXT DEFAULT 'contextual'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS broll_generator_model TEXT DEFAULT 'veo3_lite'",
        "CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_media_assets JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_keyword TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS product_video_url TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_voice_id TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_silence_trim_min_duration_seconds NUMERIC(4,2) DEFAULT 0.35",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_silence_trim_threshold_db NUMERIC(5,1) DEFAULT -45.0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_silence_trim_enabled BOOLEAN DEFAULT TRUE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_sentence_trim_enabled BOOLEAN DEFAULT FALSE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_sentence_trim_min_gap_seconds NUMERIC(4,2) DEFAULT 0.30",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_sentence_trim_keep_gap_seconds NUMERIC(4,2) DEFAULT 0.10",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS tts_pronunciation_overrides JSONB DEFAULT '[]'::jsonb",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitles_enabled BOOLEAN DEFAULT FALSE",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_mode TEXT DEFAULT 'word_by_word'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_style_preset TEXT DEFAULT 'classic'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_family TEXT DEFAULT 'pt_sans'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_color TEXT DEFAULT '#FFFFFF'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_font_weight INTEGER DEFAULT 700",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_outline_color TEXT DEFAULT '#111111'",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_outline_width NUMERIC(4,1) DEFAULT 3.0",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_margin_v INTEGER DEFAULT 140",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS subtitle_margin_percent INTEGER DEFAULT 11",
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
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS generation_source TEXT DEFAULT 'manual'",
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
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS gender TEXT",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_provider TEXT DEFAULT 'minimax'",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_voice_id TEXT",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS elevenlabs_voice_id TEXT DEFAULT '0ArNnoIAWKlT4WweaVMY'",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_chars_per_minute NUMERIC(10,2)",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_calibrated_at TIMESTAMP",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_calibration_error TEXT",
        "ALTER TABLE client_heygen_avatars ADD COLUMN IF NOT EXISTS tts_calibration_samples_json JSONB",
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
        "ALTER TABLE client_heygen_avatar_looks ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS learned_rules_scenario TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS learned_rules_visual TEXT",
        "ALTER TABLE clients ADD COLUMN IF NOT EXISTS learned_rules_video TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS feedback_rating TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS feedback_comment TEXT",
        "ALTER TABLE generated_scenarios ADD COLUMN IF NOT EXISTS feedback_categories TEXT",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS approved_by BIGINT",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS rejected_by BIGINT",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS notes TEXT",
        "ALTER TABLE telegram_user_access ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "CREATE INDEX IF NOT EXISTS idx_telegram_user_access_status ON telegram_user_access(status)",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS redirect_path TEXT NOT NULL DEFAULT '/'",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS session_token_hash TEXT",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS used_at TIMESTAMP",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '20 minutes')",
        "ALTER TABLE telegram_web_auth_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_auth_requests_status ON telegram_web_auth_requests(status)",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_auth_requests_expires ON telegram_web_auth_requests(expires_at)",
        "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS username TEXT",
        "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS first_name TEXT",
        "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS last_name TEXT",
        "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP",
        "ALTER TABLE telegram_web_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_sessions_user ON telegram_web_sessions(telegram_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_telegram_web_sessions_expires ON telegram_web_sessions(expires_at)"
    ]
    try:
        with DBConnection() as cursor:
            # Serialize schema bootstrap across all services/containers.
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", (INIT_DB_ADVISORY_LOCK_KEY,))
            for sql in tables:
                cursor.execute(sql)
            cursor.execute("ALTER TABLE clients ALTER COLUMN broll_generator_model SET DEFAULT 'veo3_lite'")
            cursor.execute(
                """
                INSERT INTO app_migrations(name)
                VALUES (%s)
                ON CONFLICT (name) DO NOTHING
                RETURNING name
                """,
                ("2026_04_15_backfill_broll_generator_model_veo3_lite",),
            )
            migration_row = cursor.fetchone()
            if migration_row:
                cursor.execute(
                    """
                    UPDATE clients
                    SET broll_generator_model = 'veo3_lite'
                    WHERE broll_generator_model IS DISTINCT FROM 'veo3_lite'
                    """
                )
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

def get_random_entity(table: str, client_id: int, exclude_ids: Optional[Set[int]] = None) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        if exclude_ids:
            exclude_params = list(exclude_ids)
            placeholders = ','.join(['%s'] * len(exclude_params))
            cursor.execute(f"SELECT * FROM {table} WHERE client_id = %s AND id NOT IN ({placeholders}) ORDER BY RANDOM() LIMIT 1", [client_id] + exclude_params)
        else:
            cursor.execute(f"SELECT * FROM {table} WHERE client_id = %s ORDER BY RANDOM() LIMIT 1", (client_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_random_topic_card(cid: int, exclude_ids: Optional[Set[int]] = None) -> Optional[Dict[str, Any]]:
    return get_random_entity("topic_cards", cid, exclude_ids)

def get_random_structure_card(cid: int, exclude_ids: Optional[Set[int]] = None) -> Optional[Dict[str, Any]]:
    return get_random_entity("structure_cards", cid, exclude_ids)

def get_random_topic_family_card(client_id: int, exclude_ids: Optional[Set[int]] = None) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        if exclude_ids:
            exclude_params = list(exclude_ids)
            placeholders = ','.join(['%s'] * len(exclude_params))
            cursor.execute(f"""
                SELECT DISTINCT ON (canonical_topic_family) * FROM topic_cards
                WHERE client_id = %s AND id NOT IN ({placeholders}) ORDER BY canonical_topic_family, created_at DESC
            """, [client_id] + exclude_params)
        else:
            cursor.execute("""
                SELECT DISTINCT ON (canonical_topic_family) * FROM topic_cards
                WHERE client_id = %s ORDER BY canonical_topic_family, created_at DESC
            """, (client_id,))
        rows = cursor.fetchall()
        if not rows: return None
        return dict(random.choice(rows))

def get_random_compatible_pair(client_id: int, exclude_pairs: Optional[Set[Tuple[int, int]]] = None) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute("""
            SELECT t.*, s.id AS structure_id, s.pattern_type, s.narrator_role, s.hook_style, s.core_thesis, 
                   s.format_type, s.item_count, s.sequence_logic, s.integration_style, s.reusable_slots, s.forbidden_drifts
            FROM topic_structure_pairs p JOIN topic_cards t ON t.id = p.topic_card_id
            JOIN structure_cards s ON s.id = p.structure_card_id
            WHERE p.client_id = %s ORDER BY RANDOM() LIMIT 500
        """, (client_id,))
        rows = cursor.fetchall()
        if not rows: return None
        if exclude_pairs:
            valid_rows = [r for r in rows if (r["id"], r["structure_id"]) not in exclude_pairs]
            if valid_rows:
                return dict(random.choice(valid_rows))
        return dict(random.choice(rows))

def get_random_compatible_family_pair(client_id: int, exclude_pairs: Optional[Set[Tuple[int, int]]] = None) -> Optional[Dict[str, Any]]:
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
        if exclude_pairs:
            valid_rows = [r for r in rows if (r["id"], r["structure_id"]) not in exclude_pairs]
            if valid_rows:
                return dict(random.choice(valid_rows))
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
                    client_id, avatar_id, avatar_name, folder_name, preview_image_url, tts_provider, tts_voice_id, elevenlabs_voice_id, is_active, usage_count, sort_order, last_used_at, gender
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                client_id,
                avatar.get("avatar_id"),
                avatar.get("avatar_name") or avatar.get("avatar_id"),
                avatar.get("folder_name"),
                avatar.get("preview_image_url"),
                avatar.get("tts_provider") if avatar.get("tts_provider") in {"minimax", "elevenlabs"} else "minimax",
                avatar.get("tts_voice_id"),
                avatar.get("elevenlabs_voice_id"),
                avatar.get("is_active", True),
                avatar.get("usage_count", 0),
                avatar.get("sort_order", avatar_index),
                avatar.get("last_used_at"),
                avatar.get("gender"),
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
        # Serialize avatar reservation per client to guarantee deterministic
        # round-robin order even under concurrent generators/workers.
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", (AVATAR_RR_LOCK_BASE_KEY + int(client_id),))

        cursor.execute("""
            SELECT a.*
            FROM client_heygen_avatars a
            LEFT JOIN (
                SELECT heygen_avatar_id, COUNT(*)::INT AS today_count
                FROM generated_scenarios
                WHERE client_id = %s
                  AND heygen_avatar_id IS NOT NULL
                  AND DATE_TRUNC('day', created_at) = DATE_TRUNC('day', CURRENT_TIMESTAMP)
                GROUP BY heygen_avatar_id
            ) today_usage ON today_usage.heygen_avatar_id = a.avatar_id
            WHERE a.client_id = %s
              AND a.is_active = TRUE
              AND EXISTS (
                SELECT 1
                FROM client_heygen_avatar_looks l
                WHERE l.client_avatar_id = a.id
                  AND l.is_active = TRUE
              )
            ORDER BY
              COALESCE(today_usage.today_count, 0) ASC,
              COALESCE(a.last_used_at, TIMESTAMP '1970-01-01') ASC,
              a.sort_order ASC,
              a.created_at ASC,
              a.id ASC
            LIMIT 1
        """, (client_id, client_id))
        avatar_row = cursor.fetchone()
        if not avatar_row:
            return None
        selected_avatar = dict(avatar_row)

        cursor.execute("""
            SELECT *
            FROM client_heygen_avatar_looks
            WHERE client_avatar_id = %s
              AND is_active = TRUE
            ORDER BY
                COALESCE(last_used_at, TIMESTAMP '1970-01-01') ASC,
                CASE
                    WHEN motion_look_id IS NOT NULL AND COALESCE(motion_status, '') IN ('ready', 'completed') THEN 0
                    ELSE 1
                END ASC,
                sort_order ASC,
                created_at ASC,
                id ASC
            LIMIT 1
        """, (selected_avatar["id"],))
        look_row = cursor.fetchone()
        selected_look = dict(look_row) if look_row else None

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
            "gender": selected_avatar.get("gender"),
            "tts_provider": selected_avatar.get("tts_provider"),
            "tts_voice_id": selected_avatar.get("tts_voice_id"),
            "elevenlabs_voice_id": selected_avatar.get("elevenlabs_voice_id"),
            "tts_chars_per_minute": selected_avatar.get("tts_chars_per_minute"),
            "tts_calibrated_at": selected_avatar.get("tts_calibrated_at"),
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
            FROM generated_scenarios gs
            WHERE gs.client_id = %s
              AND gs.montage_status = 'completed'
              AND DATE_TRUNC(
                    'month',
                    ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                  ) = DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
              AND EXISTS (
                    SELECT 1
                    FROM final_video_jobs fvj
                    WHERE fvj.client_id = gs.client_id
                      AND (
                        fvj.scenario_id = gs.id
                        OR (fvj.scenario_job_id IS NOT NULL AND fvj.scenario_job_id = gs.job_id)
                      )
                      AND DATE_TRUNC('month', ((fvj.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')) = DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                  )
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
            FROM generated_scenarios gs
            WHERE gs.client_id = %s
              AND gs.montage_status = 'completed'
              AND DATE_TRUNC(
                    'day',
                    ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                  ) = DATE_TRUNC('day', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
              AND EXISTS (
                    SELECT 1
                    FROM final_video_jobs fvj
                    WHERE fvj.client_id = gs.client_id
                      AND (
                        fvj.scenario_id = gs.id
                        OR (fvj.scenario_job_id IS NOT NULL AND fvj.scenario_job_id = gs.job_id)
                      )
                      AND DATE_TRUNC('day', ((fvj.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')) = DATE_TRUNC('day', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                  )
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
                COALESCE(open_jobs.open_count, 0) AS open_final_video_jobs,
                COALESCE(job_stats.daily_job_count, 0) AS daily_final_video_jobs,
                COALESCE(job_stats.monthly_job_count, 0) AS monthly_final_video_jobs
            FROM clients c
            LEFT JOIN (
                SELECT
                    gs.client_id,
                    COUNT(*) FILTER (
                        WHERE DATE_TRUNC(
                                'day',
                                ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                              ) = DATE_TRUNC('day', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                          AND EXISTS (
                                SELECT 1
                                FROM final_video_jobs fvj
                                WHERE fvj.client_id = gs.client_id
                                  AND (
                                    fvj.scenario_id = gs.id
                                    OR (fvj.scenario_job_id IS NOT NULL AND fvj.scenario_job_id = gs.job_id)
                                  )
                                  AND DATE_TRUNC('day', ((fvj.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')) = DATE_TRUNC('day', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                            )
                    )::int AS daily_completed_count,
                    COUNT(*)::int AS completed_count
                FROM generated_scenarios gs
                WHERE gs.montage_status = 'completed'
                  AND DATE_TRUNC(
                        'month',
                        ((COALESCE(gs.montage_yandex_uploaded_at, gs.montage_updated_at, gs.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                      ) = DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                  AND EXISTS (
                        SELECT 1
                        FROM final_video_jobs fvj
                        WHERE fvj.client_id = gs.client_id
                          AND (
                            fvj.scenario_id = gs.id
                            OR (fvj.scenario_job_id IS NOT NULL AND fvj.scenario_job_id = gs.job_id)
                          )
                          AND DATE_TRUNC('month', ((fvj.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')) = DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                    )
                GROUP BY gs.client_id
            ) completed ON completed.client_id = c.id
            LEFT JOIN (
                SELECT client_id, COUNT(*)::int AS open_count
                FROM final_video_jobs
                WHERE status IN ('queued', 'processing')
                GROUP BY client_id
            ) open_jobs ON open_jobs.client_id = c.id
            LEFT JOIN (
                SELECT
                    client_id,
                    COUNT(*) FILTER (
                        WHERE DATE_TRUNC(
                                'day',
                                ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                              ) = DATE_TRUNC('day', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                    )::int AS daily_job_count,
                    COUNT(*) FILTER (
                        WHERE DATE_TRUNC(
                                'month',
                                ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
                              ) = DATE_TRUNC('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow'))
                    )::int AS monthly_job_count
                FROM final_video_jobs
                GROUP BY client_id
            ) job_stats ON job_stats.client_id = c.id
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

def get_telegram_user_access(telegram_user_id: int) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            "SELECT * FROM telegram_user_access WHERE telegram_user_id = %s",
            (int(telegram_user_id),),
        )
        row = cursor.fetchone()
        return dict(row) if row else None

def request_telegram_access(
    telegram_user_id: int,
    username: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
) -> Dict[str, Any]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            INSERT INTO telegram_user_access (
                telegram_user_id, username, first_name, last_name, status, requested_at, updated_at
            )
            VALUES (%s, %s, %s, %s, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_user_id) DO UPDATE SET
                username = COALESCE(EXCLUDED.username, telegram_user_access.username),
                first_name = COALESCE(EXCLUDED.first_name, telegram_user_access.first_name),
                last_name = COALESCE(EXCLUDED.last_name, telegram_user_access.last_name),
                status = CASE
                    WHEN telegram_user_access.is_admin = TRUE OR telegram_user_access.status = 'approved' THEN 'approved'
                    ELSE 'pending'
                END,
                requested_at = CASE
                    WHEN telegram_user_access.is_admin = TRUE OR telegram_user_access.status = 'approved'
                        THEN telegram_user_access.requested_at
                    ELSE CURRENT_TIMESTAMP
                END,
                approved_at = CASE
                    WHEN telegram_user_access.is_admin = TRUE OR telegram_user_access.status = 'approved'
                        THEN telegram_user_access.approved_at
                    ELSE NULL
                END,
                approved_by = CASE
                    WHEN telegram_user_access.is_admin = TRUE OR telegram_user_access.status = 'approved'
                        THEN telegram_user_access.approved_by
                    ELSE NULL
                END,
                rejected_at = NULL,
                rejected_by = NULL,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            (int(telegram_user_id), username, first_name, last_name),
        )
        row = cursor.fetchone()
        return dict(row) if row else {}

def ensure_telegram_admin(
    telegram_user_id: int,
    username: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
) -> Dict[str, Any]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            INSERT INTO telegram_user_access (
                telegram_user_id, username, first_name, last_name, status, is_admin, approved_at, approved_by, updated_at
            )
            VALUES (%s, %s, %s, %s, 'approved', TRUE, CURRENT_TIMESTAMP, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_user_id) DO UPDATE SET
                username = COALESCE(EXCLUDED.username, telegram_user_access.username),
                first_name = COALESCE(EXCLUDED.first_name, telegram_user_access.first_name),
                last_name = COALESCE(EXCLUDED.last_name, telegram_user_access.last_name),
                status = 'approved',
                is_admin = TRUE,
                approved_at = COALESCE(telegram_user_access.approved_at, CURRENT_TIMESTAMP),
                approved_by = COALESCE(telegram_user_access.approved_by, EXCLUDED.approved_by),
                rejected_at = NULL,
                rejected_by = NULL,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            (int(telegram_user_id), username, first_name, last_name, int(telegram_user_id)),
        )
        row = cursor.fetchone()
        return dict(row) if row else {}

def approve_telegram_user(telegram_user_id: int, admin_telegram_user_id: int) -> Dict[str, Any]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            INSERT INTO telegram_user_access (
                telegram_user_id, status, is_admin, approved_at, approved_by, updated_at
            )
            VALUES (%s, 'approved', FALSE, CURRENT_TIMESTAMP, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_user_id) DO UPDATE SET
                status = 'approved',
                approved_at = CURRENT_TIMESTAMP,
                approved_by = EXCLUDED.approved_by,
                rejected_at = NULL,
                rejected_by = NULL,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            (int(telegram_user_id), int(admin_telegram_user_id)),
        )
        row = cursor.fetchone()
        return dict(row) if row else {}

def reject_telegram_user(telegram_user_id: int, admin_telegram_user_id: int) -> Dict[str, Any]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            INSERT INTO telegram_user_access (
                telegram_user_id, status, is_admin, rejected_at, rejected_by, updated_at
            )
            VALUES (%s, 'rejected', FALSE, CURRENT_TIMESTAMP, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_user_id) DO UPDATE SET
                status = CASE WHEN telegram_user_access.is_admin = TRUE THEN 'approved' ELSE 'rejected' END,
                rejected_at = CASE WHEN telegram_user_access.is_admin = TRUE THEN NULL ELSE CURRENT_TIMESTAMP END,
                rejected_by = CASE WHEN telegram_user_access.is_admin = TRUE THEN NULL ELSE EXCLUDED.rejected_by END,
                approved_at = CASE WHEN telegram_user_access.is_admin = TRUE THEN telegram_user_access.approved_at ELSE NULL END,
                approved_by = CASE WHEN telegram_user_access.is_admin = TRUE THEN telegram_user_access.approved_by ELSE NULL END,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
            """,
            (int(telegram_user_id), int(admin_telegram_user_id)),
        )
        row = cursor.fetchone()
        return dict(row) if row else {}

def list_pending_telegram_users(limit: int = 25) -> List[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT *
            FROM telegram_user_access
            WHERE status = 'pending'
            ORDER BY requested_at ASC, id ASC
            LIMIT %s
            """,
            (int(limit),),
        )
        rows = cursor.fetchall() or []
        return [dict(row) for row in rows]

def list_telegram_users(limit: int = 50, status: Optional[str] = None) -> List[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        if status in {"pending", "approved", "rejected"}:
            cursor.execute(
                """
                SELECT *
                FROM telegram_user_access
                WHERE status = %s
                ORDER BY updated_at DESC, id DESC
                LIMIT %s
                """,
                (status, int(limit)),
            )
        else:
            cursor.execute(
                """
                SELECT *
                FROM telegram_user_access
                ORDER BY updated_at DESC, id DESC
                LIMIT %s
                """,
                (int(limit),),
            )
        rows = cursor.fetchall() or []
        return [dict(row) for row in rows]

def is_telegram_user_approved(telegram_user_id: int) -> bool:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM telegram_user_access
            WHERE telegram_user_id = %s AND status = 'approved'
            LIMIT 1
            """,
            (int(telegram_user_id),),
        )
        return cursor.fetchone() is not None

def is_telegram_admin(telegram_user_id: int) -> bool:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM telegram_user_access
            WHERE telegram_user_id = %s AND status = 'approved' AND is_admin = TRUE
            LIMIT 1
            """,
            (int(telegram_user_id),),
        )
        return cursor.fetchone() is not None

def _hash_session_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def attach_telegram_user_to_web_auth_request(
    request_id: str,
    nonce: str,
    telegram_user_id: int,
) -> bool:
    with DBConnection() as cursor:
        cursor.execute(
            """
            UPDATE telegram_web_auth_requests
            SET telegram_user_id = COALESCE(telegram_user_id, %s),
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = %s
              AND nonce = %s
              AND status = 'pending'
              AND expires_at > CURRENT_TIMESTAMP
            """,
            (int(telegram_user_id), str(request_id), str(nonce)),
        )
        return (cursor.rowcount or 0) > 0

def approve_telegram_web_auth_request(
    request_id: str,
    nonce: str,
    telegram_user_id: int,
    username: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    session_ttl_hours: int = 24,
) -> Optional[Dict[str, Any]]:
    with DBConnection(use_dict_cursor=True) as cursor:
        cursor.execute(
            """
            SELECT *
            FROM telegram_web_auth_requests
            WHERE request_id = %s
              AND nonce = %s
              AND status = 'pending'
              AND expires_at > CURRENT_TIMESTAMP
            FOR UPDATE
            """,
            (str(request_id), str(nonce)),
        )
        auth_row = cursor.fetchone()
        if not auth_row:
            return None

        token = secrets.token_urlsafe(48)
        token_hash = _hash_session_token(token)
        ttl_hours = max(1, int(session_ttl_hours or 24))

        cursor.execute(
            """
            INSERT INTO telegram_web_sessions (
                session_token_hash,
                telegram_user_id,
                username,
                first_name,
                last_name,
                expires_at,
                last_seen_at
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s,
                CURRENT_TIMESTAMP + (%s * INTERVAL '1 hour'),
                CURRENT_TIMESTAMP
            )
            """,
            (token_hash, int(telegram_user_id), username, first_name, last_name, ttl_hours),
        )

        cursor.execute(
            """
            UPDATE telegram_web_auth_requests
            SET status = 'approved',
                telegram_user_id = %s,
                session_token_hash = %s,
                session_expires_at = CURRENT_TIMESTAMP + (%s * INTERVAL '1 hour'),
                approved_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING request_id, redirect_path, status, session_expires_at
            """,
            (int(telegram_user_id), token_hash, ttl_hours, auth_row["id"]),
        )
        updated = cursor.fetchone()
        if not updated:
            return None

        payload = dict(updated)
        payload["session_token"] = token
        return payload

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
