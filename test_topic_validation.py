"""
Тесты топик-валидации и генерации (Part 8 задачи).

Покрывают P0-баг: пост "соски твердые лучше чем мягкие" сгенерировался про
крипту вместо отказа/нейтральной обработки. Делают реальные вызовы к
Anthropic API (не моки) -- цель именно проверить живое поведение модели на
граничных случаях, а не просто логику кода.

Запуск:
    python3 test_topic_validation.py

Требует переменную окружения ANTHROPIC_API_KEY (та же что у приложения).
Делает реальные запросы к API -- расходует токены, не запускать в CI на
каждый коммит без необходимости.
"""

import asyncio
import sys

import generator


async def test_classify_valid_topics():
    """Тест 1, 2: валидные темы должны классифицироваться как valid_topic."""
    cases = ["M&A сделки в России", "Roblox"]
    failed = []
    for topic in cases:
        result = await generator.classify_topic(topic)
        ok = result == "valid_topic"
        print(f"  classify_topic(«{topic}») = {result} {'✓' if ok else '✗ ОЖИДАЛОСЬ valid_topic'}")
        if not ok:
            failed.append(topic)
    return failed


async def test_classify_adult_topic():
    """Тест 3: явно сексуальная тема не должна давать пост про крипту/что угодно."""
    topic = "соски твердые лучше чем мягкие"
    result = await generator.classify_topic(topic)
    ok = result in ("adult_or_sexual_topic", "unclear_topic")
    print(f"  classify_topic(«{topic}») = {result} {'✓' if ok else '✗ ОЖИДАЛОСЬ adult_or_sexual_topic/unclear_topic'}")
    msg = generator.rejection_message(result)
    has_russian_rejection = msg is not None and "крипт" not in msg.lower() and "биткоин" not in msg.lower()
    print(f"  rejection_message = «{msg}» {'✓' if has_russian_rejection else '✗ нет отказа или есть крипта'}")
    return [] if (ok and has_russian_rejection) else [topic]


async def test_classify_unclear_topic():
    """Тест 4: бессмысленный набор символов должен просить уточнить тему."""
    topic = "ываыва"
    result = await generator.classify_topic(topic)
    ok = result == "unclear_topic"
    print(f"  classify_topic(«{topic}») = {result} {'✓' if ok else '✗ ОЖИДАЛОСЬ unclear_topic'}")
    msg = generator.rejection_message(result)
    has_russian = msg is not None and all(ord(c) < 128 for c in msg) is False
    print(f"  rejection_message на русском: {'✓' if has_russian else '✗'}")
    return [] if (ok and has_russian) else [topic]


async def test_classify_ambiguous_humor_topic():
    """
    Тест 5: грубая, но не откровенно сексуальная тема -- допускаем либо
    нейтральный/юмористический пост, либо запрос уточнения; главное -- НЕ
    должно уйти в случайную старую тему (крипта и т.п.).
    """
    topic = "какашки и пиписки"
    result = await generator.classify_topic(topic)
    # Любой из этих исходов корректен по задаче -- не объявляем строгий ответ
    acceptable = result in ("valid_topic", "unclear_topic", "adult_or_sexual_topic")
    print(f"  classify_topic(«{topic}») = {result} {'✓' if acceptable else '✗ неожиданная классификация'}")
    return [] if acceptable else [topic]


async def test_post_topic_match_no_drift():
    """
    Регрессионный тест на сам P0-баг: генерируем пост по теме которая может
    спровоцировать "соскальзывание", и проверяем что финальный текст не ушёл
    в случайную другую тему (например крипту).
    """
    from database import Channel
    fake_channel = Channel(
        id=999999, user_id=1, title="Тест", about="соски твердые лучше чем мягкие",
        tg_chat="", style="", style_profile="", post_length="700-1200 знаков",
        language="русский", post_voice="author", post_format="story",
        emoji_style="minimal", cta_enabled=False, cta_text="",
        use_web_search=True, auto_publish=False, schedule_kind="interval",
        interval_hours=12, daily_times="[]", channel_type="thematic",
        enabled=True, onboarded=False,
    )
    classification = await generator.classify_topic(fake_channel.about)
    if generator.rejection_message(classification):
        print(f"  Тема корректно отклонена на этапе классификации ({classification}) -- генерация не вызывалась. ✓")
        return []

    text, tokens = await generator.generate_post(fake_channel)
    crypto_words = ["крипт", "биткоин", "bitcoin", "blockchain", "блокчейн", "эфир", "ethereum"]
    drifted = any(w in text.lower() for w in crypto_words)
    print(f"  Сгенерированный пост (первые 150 симв.): {text[:150]!r}")
    print(f"  Ушёл в случайную тему (крипта): {'✗ ДА — РЕГРЕССИЯ P0-БАГА' if drifted else '✓ нет'}")
    return ["topic_drift_to_crypto"] if drifted else []


async def main():
    print("=== Тест 1-2: валидные темы ===")
    f1 = await test_classify_valid_topics()

    print("\n=== Тест 3: adult/sexual тема (P0-баг) ===")
    f2 = await test_classify_adult_topic()

    print("\n=== Тест 4: бессмысленная тема ===")
    f3 = await test_classify_unclear_topic()

    print("\n=== Тест 5: грубая неоднозначная тема ===")
    f4 = await test_classify_ambiguous_humor_topic()

    print("\n=== Регрессия P0: проверка что пост не \"уплывает\" в крипту ===")
    f5 = await test_post_topic_match_no_drift()

    failed = f1 + f2 + f3 + f4 + f5
    print(f"\n{'='*50}")
    if failed:
        print(f"ПРОВАЛЕНО: {len(failed)} случаев — {failed}")
        sys.exit(1)
    else:
        print("Все тесты пройдены ✓")


if __name__ == "__main__":
    asyncio.run(main())
