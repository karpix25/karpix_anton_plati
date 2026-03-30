import json
import logging

from psycopg2.extras import RealDictCursor

from services.v1.database.db_service import get_db_connection, normalize_topic_data


logger = logging.getLogger("TopicNormalizer")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


def _json(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value or {}


def normalize_topic_cards():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT * FROM topic_cards ORDER BY client_id, id")
    rows = cursor.fetchall()

    updated = 0

    for row in rows:
      topic_data = {
          "topic_short": row.get("topic_short"),
          "topic_family": row.get("topic_family"),
          "topic_cluster": row.get("topic_cluster"),
          "topic_angle": row.get("topic_angle"),
          "promise": row.get("promise"),
          "pain_point": row.get("pain_point"),
          "proof_type": row.get("proof_type"),
          "cta_type": row.get("cta_type"),
          **_json(row.get("metadata_json")),
      }
      normalized = normalize_topic_data(topic_data)
      cursor.execute(
          """
          UPDATE topic_cards
          SET
              topic_family = %s,
              canonical_topic_family = %s,
              metadata_json = %s::jsonb
          WHERE id = %s
          """,
          (
              normalized.get("topic_family"),
              normalized.get("canonical_topic_family"),
              json.dumps(normalized, ensure_ascii=False),
              row["id"],
          ),
      )
      updated += 1

    conn.commit()
    cursor.close()
    conn.close()
    logger.info("Normalized %s topic cards", updated)
    return updated


if __name__ == "__main__":
    normalize_topic_cards()
