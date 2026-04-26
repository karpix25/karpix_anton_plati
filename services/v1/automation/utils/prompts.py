import json

HOOK_BAN_PHRASES = [
    "думаешь",
    "думаете",
    "а вот и нет",
    "забудьте",
    "прикол в том",
]

FILLER_WORDS_BAN = [
    "короче",
    "типа",
    "ну",
    "как бы",
    "в общем",
    "в целом",
    "значит",
    "понимаешь",
    "знаешь",
    "по сути",
]

def get_asset_visibility_guardrails() -> str:
    return """
    ASSET VISIBILITY CONSTRAINTS:
    - We cannot show real third-party websites, app screens, or arbitrary consumer products unless a real asset was prepared in advance.
    - Therefore do NOT write lines that point at a concrete unseen object as if the viewer can see it on screen.
    - Forbidden examples: "вот эти сайты", "вот этот сайт", "первый сайт", "второй сайт", "вот этот крем", "вот этот спрей", "вот это приложение".
    - If you need to mention resources or items, speak generically and non-pointingly: "есть сервис, который...", "одна платформа помогает...", "несколько сайтов с визовой информацией", "средство от комаров", "крем с высоким SPF".
    - Do not build the script around numbered unseen websites or products that imply on-screen demonstration.
    - The script must remain truthful for a talking-head video even if no external website/product footage is shown.
    """

def get_spoken_numbers_guardrail() -> str:
    return """
    SPOKEN NUMBERS RULE:
    - ALL numbers in the final Russian script must be written out in words, never as Arabic numerals.
    - This applies to counts, prices, percentages, years, dates, times, ranges, ratios, durations, limits, and list numbers.
    - Examples: "двадцать", "сто пятьдесят", "девяносто восемь процентов", "две тысячи двадцать шестой год", "от трех до пяти дней".
    - Do not output forms like "20", "1500", "98%", "2026", "3-5 дней", even if the source used digits.
    - If an exact number sounds unnatural in speech, rewrite it into a natural spoken form while preserving the meaning as closely as possible.
    """

def get_forbidden_tags_guardrail() -> str:
    return """
    FORBIDDEN TAGS RULE:
    - DO NOT use any interjection or emotion tags in the script.
    - Strictly forbidden: (breath), (inhale), (chuckle), (chuckles), (sighs), (snorts), (gasps), (emm), (hum), (laughter), (pause).
    - Do not put any instructions in parentheses inside the script.
    - The output must be pure spoken text only.
    """
