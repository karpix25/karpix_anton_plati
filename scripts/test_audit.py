import os
import json
from services.v1.automation.audit_service import get_transcript_audit
from dotenv import load_dotenv

load_dotenv()

sample_transcript = """
Хочешь путешествовать по миру и не париться об оплате? 
Я нашел способ, как бронировать отели и оплачивать кафе в любой стране картой РФ.
Смотри это видео до конца, и я расскажу про сервис Плати по миру.
Это реально работает, я сам проверил в Париже и Стамбуле.
Просто переходи по ссылке в профиле и заказывай карту.
"""

audit = get_transcript_audit(sample_transcript, niche="Путешествия", target_product_info="Плати по миру - оплата зарубежных сервисов")
print(json.dumps(audit, indent=2, ensure_ascii=False))
