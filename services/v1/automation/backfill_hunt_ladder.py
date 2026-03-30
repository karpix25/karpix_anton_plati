import json
import logging

from services.v1.automation.audit_service import classify_hunt_ladder
from services.v1.database.db_service import get_db_connection

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("HuntBackfill")


def main():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, niche, transcript, target_product_info, audit_json
        FROM processed_content
        WHERE transcript IS NOT NULL
          AND (
            audit_json IS NULL
            OR audit_json->'hunt_ladder'->>'stage' IS NULL
            OR audit_json->'hunt_ladder'->>'stage' = ''
            OR audit_json->'hunt_ladder'->>'stage' = 'Не определена'
          )
        ORDER BY created_at DESC
        """
    )
    rows = cur.fetchall()
    logger.info("Found %s rows without Hunt ladder", len(rows))

    updated = 0
    failed = 0

    for row in rows:
        content_id, niche, transcript, target_product_info, audit_json = row
        try:
            hunt = classify_hunt_ladder(
                transcript=transcript,
                niche=niche or "General",
                target_product_info=target_product_info,
            )
            payload = audit_json or {}
            payload["hunt_ladder"] = hunt
            cur.execute(
                "UPDATE processed_content SET audit_json = %s::jsonb WHERE id = %s",
                (json.dumps(payload, ensure_ascii=False), content_id),
            )
            updated += 1
            logger.info("Updated content_id=%s with stage=%s", content_id, hunt.get("stage"))
        except Exception as e:
            failed += 1
            logger.error("Failed content_id=%s: %s", content_id, e)

    conn.commit()
    cur.close()
    conn.close()
    logger.info("Backfill finished. Updated=%s Failed=%s", updated, failed)


if __name__ == "__main__":
    main()
