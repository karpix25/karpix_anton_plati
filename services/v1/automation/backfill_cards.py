import json
import logging

from psycopg2.extras import RealDictCursor

from services.v1.database.db_service import (
    get_db_connection,
    save_topic_card,
    save_structure_card,
    link_content_to_cards,
    save_topic_structure_pair,
)


logger = logging.getLogger("CardBackfill")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}


def _build_topic_card(audit_json, niche):
    strategy = _json(audit_json).get("reference_strategy", {})
    return {
        "topic_short": strategy.get("topic_cluster") or niche,
        "topic_family": strategy.get("topic_family") or strategy.get("topic_cluster") or niche,
        "topic_cluster": strategy.get("topic_cluster") or niche,
        "topic_angle": strategy.get("topic_angle") or "Без угла",
        "promise": strategy.get("promise"),
        "pain_point": strategy.get("pain_point"),
        "proof_type": strategy.get("proof_type"),
        "cta_type": strategy.get("cta_type"),
    }


def _build_structure_card(audit_json):
    pattern = _json(audit_json).get("pattern_framework", {})
    return {
        "pattern_type": pattern.get("pattern_type", "other"),
        "narrator_role": pattern.get("narrator_role"),
        "hook_style": pattern.get("hook_style"),
        "core_thesis": pattern.get("core_thesis"),
        "content_shape": pattern.get("content_shape", {}),
        "argument_style": pattern.get("argument_style"),
        "integration_style": pattern.get("integration_style", {}),
        "reusable_slots": pattern.get("reusable_slots", {}),
        "forbidden_drifts": pattern.get("forbidden_drifts", []),
    }


def backfill_cards():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute(
        """
        SELECT id, job_id, client_id, niche, audit_json, topic_card_id, structure_card_id
        FROM processed_content
        WHERE client_id IS NOT NULL
          AND audit_json IS NOT NULL
        ORDER BY id ASC
        """
    )
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    processed = 0

    for row in rows:
        topic_card_id = row.get("topic_card_id")
        structure_card_id = row.get("structure_card_id")
        audit_json = _json(row.get("audit_json"))

        if not topic_card_id:
            topic_card_id = save_topic_card(
                row["client_id"],
                _build_topic_card(audit_json, row.get("niche") or "General"),
                source_content_id=row["id"],
            )

        if not structure_card_id:
            structure_card_id = save_structure_card(
                row["client_id"],
                _build_structure_card(audit_json),
                source_content_id=row["id"],
            )

        link_content_to_cards(
            row["job_id"],
            topic_card_id=topic_card_id,
            structure_card_id=structure_card_id,
        )
        save_topic_structure_pair(
            row["client_id"],
            topic_card_id,
            structure_card_id,
            source_content_id=row["id"],
        )
        processed += 1

    logger.info("Backfilled %s processed_content rows", processed)
    return processed


if __name__ == "__main__":
    backfill_cards()
