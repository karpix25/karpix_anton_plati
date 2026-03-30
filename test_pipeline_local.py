import os
import json
import logging
from dotenv import load_dotenv

# Import our pipeline components
from services.v1.automation.pipeline_orchestrator import run_content_gen_pipeline
from services.v1.database.db_service import init_db

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables from .env
load_dotenv()

def test_manual_transcription_flow():
    """
    Simulates a pipeline run with a manually provided transcription.
    """
    job_id = "test_run_romantic_travel"
    
    # User provided transcription
    transcript = """
    5 мест, где должна побывать каждая влюбленная парочка. 5 место. Остров Санторини, Греция. Белоснежные домики, синие купола церквей и бомбические закаты. Все это в жерле древнего вулкана, на осколках которого и образовался остров. Идеальное место для медового месяца. Место номер 4. Киото, Япония. Сюда обязательно нужно попасть в сезон цветения сакуры. В конце марта или начале апреля. Тысячи деревьев превращают город в розовое облако. Здесь вы почувствуете себя героями аниме про любовь. 3 место. Остров Камода, Индонезия. Здесь живут знаменитые комодские варан. длиной до 3 метров. Реально, как драконы или динозавры. А главная фишка для влюбленных – розовые пляжи. Песок здесь по-настоящему розовый из-за измельченных кораллов. Просто вау! Второе место – Каппадокия, Турция. Вы поднимаетесь на воздушном шаре, а под вами марсиантки. и пейзажи с древними пещерными городами и сотни разноцветных шаров вокруг. Это буквально другой мир. Очень доступно по деньгам и станет идеальным подарком для второй половины. Первое место, естественно, Париж. Конечно, это может показаться банальным, но побывать в Париже именно с любимым человеком должен каждый. Эфелева башня с ее ночной подсветкой, Мулен Руш, Лувр. Все это супер романтичные места, проверенные временем и миллионом влюбленных. Чтобы ваше романтическое путешествие по этим сказочным местам было наполнено только нежностью и не омрачалось проблемами с оплатой ужинов или экскурсий, друзья посоветовали мне сервис «Плати по миру». Это идеальный помощник для пар: международную карту мне оформили онлайн всего за 5 минут! Она сразу привязывается к телефону (Apple Pay / Google Pay), и в любой точке мира — от Парижа до Киото — я плачу просто смартфоном. Пополняю баланс обычными рублями за пару минут — никакой головной боли с наличкой или поиском работающих обменников. С такой картой границы для вашей романтики просто исчезают!
    """
    
    niche = "Романтические Путешествия"
    target_product = "Сервис международный платежей 'Плати по миру'. Оформление карты за 5 минут, пополнение рублями, Apple Pay везде."
    
    logger.info("Initializing database...")
    init_db()
    
    logger.info("Starting pipeline test...")
    try:
        # Note: We skip Phase 0 (Ingestion/Transcription) since we have the text
        # We pass avatar_id as a dummy since we aren't executing HeyGen in this check
        result = run_content_gen_pipeline(
            job_id=job_id,
            transcript=transcript,
            niche=niche,
            target_product_info=target_product,
            analysis_only=True
        )
        logger.info("Pipeline test execution triggered successfully!")
        print("\n--- AUDIT RESULTS ---")
        print(json.dumps(result.get("audit", {}), indent=2, ensure_ascii=False))
        
        # In a real scenario, we'd check the DB for the results
        print("\n--- TEST COMPLETE ---")
        print(f"Check the logs above for Phase 1 (Audit), Phase 2 (Scenario), and Phase 3 (B-roll) results.")
        
    except Exception as e:
        logger.error(f"Pipeline test failed: {e}")

if __name__ == "__main__":
    test_manual_transcription_flow()
