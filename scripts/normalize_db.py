import os
import sys
import json
import logging
from dotenv import load_dotenv

# Add root to sys.path
sys.path.append(os.getcwd())

# Load environment variables
load_dotenv()

from services.v1.database.db_service import DBConnection, ContentNormalizer, _json_dumps

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def normalize_existing_records():
    with DBConnection(use_dict_cursor=True) as cursor:
        # 1. Update Topic Cards
        logger.info("Normalizing Topic Cards...")
        cursor.execute("SELECT id, topic_family, topic_cluster, topic_short, topic_angle, metadata_json FROM topic_cards")
        topics = cursor.fetchall()
        
        for t in topics:
            # Re-normalize using the new logic
            topic_data = t.copy()
            # If metadata_json exists, merge it
            if t['metadata_json']:
                try:
                    meta = json.loads(t['metadata_json']) if isinstance(t['metadata_json'], str) else t['metadata_json']
                    topic_data.update(meta)
                except:
                    pass
            
            normalized = ContentNormalizer.normalize_topic_data(topic_data)
            
            # Simple heuristic for missing country/hunt_stage
            country = normalized.get('country')
            if not country:
                # Try to find country names in topic_short or topic_family
                text = (t['topic_short'] or "") + " " + (t['topic_family'] or "")
                countries = ["Россия", "Турция", "Европа", "Азия", "США", "Таиланд", "Бали"]
                for c in countries:
                    if c.lower() in text.lower():
                        country = c
                        break
                if not country: country = "Global"
            
            hunt_stage = normalized.get('hunt_stage')
            if not hunt_stage:
                # Heuristic for Hunt Stage
                text = (t['topic_short'] or "") + " " + (t['topic_angle'] or "")
                if any(x in text.lower() for x in ["как", "зачем", "почему", "проблема"]):
                    hunt_stage = "Awareness"
                elif any(x in text.lower() for x in ["топ", "лучшие", "сравнение"]):
                    hunt_stage = "Consideration"
                else:
                    hunt_stage = "Solution"

            cursor.execute("""
                UPDATE topic_cards 
                SET canonical_topic_family = %s,
                    country = %s,
                    hunt_stage = %s
                WHERE id = %s
            """, (normalized['canonical_topic_family'], country, hunt_stage, t['id']))

        # 2. Update Structure Cards
        logger.info("Normalizing Structure Cards...")
        cursor.execute("SELECT id, pattern_type, narrator_role, hook_style, format_type, sequence_logic FROM structure_cards")
        structures = cursor.fetchall()
        
        for s in structures:
            # Re-normalize
            struct_data = {
                "pattern_type": s['pattern_type'],
                "narrator_role": s['narrator_role'],
                "hook_style": s['hook_style'],
                "content_shape": {
                    "format_type": s['format_type'],
                    "sequence_logic": s['sequence_logic']
                }
            }
            normalized_s = ContentNormalizer.normalize_structure_data(struct_data)
            
            cursor.execute("""
                UPDATE structure_cards 
                SET canonical_pattern_key = %s,
                    structure_fingerprint = %s
                WHERE id = %s
            """, (normalized_s['canonical_pattern_key'], normalized_s['structure_fingerprint'], s['id']))

        logger.info(f"Normalization complete. Updated {len(topics)} topics and {len(structures)} structures.")

if __name__ == "__main__":
    try:
        normalize_existing_records()
    except Exception as e:
        logger.error(f"Normalization failed: {e}")
        sys.exit(1)
