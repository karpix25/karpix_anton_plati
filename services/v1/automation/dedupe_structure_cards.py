import json
import logging

from psycopg2.extras import RealDictCursor

from services.v1.database.db_service import get_db_connection, normalize_structure_data


logger = logging.getLogger("StructureDeduper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}


def dedupe_structure_cards():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT * FROM structure_cards ORDER BY client_id, id")
    rows = cursor.fetchall()

    kept = {}
    merged_count = 0
    updated_count = 0

    for row in rows:
        structure_data = {
            "pattern_type": row.get("pattern_type"),
            "narrator_role": row.get("narrator_role"),
            "hook_style": row.get("hook_style"),
            "core_thesis": row.get("core_thesis"),
            "content_shape": {
                "format_type": row.get("format_type"),
                "item_count": row.get("item_count"),
                "sequence_logic": _json(row.get("sequence_logic")),
            },
            "integration_style": _json(row.get("integration_style")),
            "reusable_slots": _json(row.get("reusable_slots")),
            "forbidden_drifts": _json(row.get("forbidden_drifts")),
        }
        normalized = normalize_structure_data(structure_data)
        key = (
            row["client_id"],
            normalized["canonical_pattern_key"],
            normalized["structure_fingerprint"],
        )

        canonical_id = kept.get(key)
        if canonical_id:
            cursor.execute(
                "UPDATE processed_content SET structure_card_id = %s WHERE structure_card_id = %s",
                (canonical_id, row["id"]),
            )
            cursor.execute(
                """
                INSERT INTO topic_structure_pairs (client_id, topic_card_id, structure_card_id, source_content_id, pair_count, updated_at)
                SELECT client_id, topic_card_id, %s, source_content_id, pair_count, CURRENT_TIMESTAMP
                FROM topic_structure_pairs
                WHERE structure_card_id = %s
                ON CONFLICT (client_id, topic_card_id, structure_card_id)
                DO UPDATE SET
                    pair_count = topic_structure_pairs.pair_count + EXCLUDED.pair_count,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (canonical_id, row["id"]),
            )
            cursor.execute("DELETE FROM topic_structure_pairs WHERE structure_card_id = %s", (row["id"],))
            cursor.execute("DELETE FROM structure_cards WHERE id = %s", (row["id"],))
            merged_count += 1
            continue

        kept[key] = row["id"]
        cursor.execute(
            """
            UPDATE structure_cards
            SET
                pattern_type = %s,
                canonical_pattern_key = %s,
                structure_fingerprint = %s,
                narrator_role = %s,
                hook_style = %s,
                format_type = %s
            WHERE id = %s
            """,
            (
                normalized.get("pattern_type"),
                normalized.get("canonical_pattern_key"),
                normalized.get("structure_fingerprint"),
                normalized.get("narrator_role"),
                normalized.get("hook_style"),
                (normalized.get("content_shape") or {}).get("format_type"),
                row["id"],
            ),
        )
        updated_count += 1

    conn.commit()
    cursor.close()
    conn.close()
    logger.info("Updated %s canonical structure cards, merged %s duplicates", updated_count, merged_count)
    return {"updated": updated_count, "merged": merged_count}


if __name__ == "__main__":
    dedupe_structure_cards()
