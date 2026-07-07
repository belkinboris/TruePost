"""
Тесты итерации генератора "не тот стиль" (SPEC_TRUEPOST_GENERATOR_STYLE).

Промпт-тесты не вызывают Claude API -- проверяют построение system-промпта
через monkeypatching _call_claude (перехватываем аргументы).

Запуск:

    DATABASE_URL=sqlite:///test_style.db TRUEPOST_INTERNAL_API_TOKEN=test-token SECRET_KEY=testsecret \\
        python3 test_generator_style.py
    (сервер не нужен -- всё локально)
"""

import asyncio
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///test_style.db")
os.environ.setdefault("SECRET_KEY", "testsecret")
os.environ.setdefault("TRUEPOST_INTERNAL_API_TOKEN", "test-token")

import generator
from database import Channel


def _make_channel(**kw) -> Channel:
    defaults = dict(
        user_id=1, title="Тест", tg_chat="", about="садоводство",
        style="", style_profile="", post_length="100 слов",
        language="русский", channel_type="thematic",
        use_web_search=False, verified=False,
    )
    defaults.update(kw)
    return Channel(**defaults)


captured = {}


async def _fake_call_claude(system, user, use_web_search, max_tokens=700):
    captured["system"] = system
    captured["user"] = user
    return "Тестовый пост про садоводство. Конкретный пример: сосед Иван вырастил томаты.", 100


async def _fake_topic_match(post_text, topic):
    return True, 0


# ── 1. unverified + образцы -> блок зеркалирования в промпте ────────────────

async def test_samples_produce_mirror_block():
    generator._call_claude = _fake_call_claude
    generator._check_topic_match = _fake_topic_match

    ch = _make_channel(style_profile="[ОБРАЗЦЫ СТИЛЯ]\nПривет, друзья! Сегодня расскажу про мои грядки 🌱\n\nКороче, посадил огурцы — растут как бешеные!")
    await generator.generate_post(ch)

    sys = captured["system"]
    assert "ОБРАЗЦЫ СТИЛЯ АВТОРА" in sys, "Блок зеркалирования должен попасть в промпт"
    assert "НЕОТЛИЧИМЫМ по стилю" in sys, "Инструкция зеркалирования из SPEC"
    assert "Не копируй содержание" in sys, "Инструкция про содержание из SPEC"
    assert "мои грядки" in sys, "Сами образцы должны попасть в промпт"
    assert "ТОН (пресет" not in sys, "При наличии образцов пресет тона НЕ добавляется"
    print("  unverified + образцы -> блок зеркалирования в промпте ✓")


# ── 2. unverified + пропуск -> пресет тона по типу канала ───────────────────

async def test_skip_produces_tone_preset_thematic():
    generator._call_claude = _fake_call_claude
    generator._check_topic_match = _fake_topic_match

    ch = _make_channel(channel_type="thematic")  # без style, без style_profile
    await generator.generate_post(ch)

    sys = captured["system"]
    assert 'ТОН (пресет "автор-эксперт")' in sys, "Тематический канал без стиля -> пресет автор-эксперт"
    assert "ОБРАЗЦЫ СТИЛЯ АВТОРА" not in sys
    print("  unverified + пропуск (thematic) -> пресет 'автор-эксперт' ✓")


async def test_skip_produces_tone_preset_news():
    generator._call_claude = _fake_call_claude
    generator._check_topic_match = _fake_topic_match

    ch = _make_channel(channel_type="news", about="новости технологий")
    await generator.generate_post(ch)

    sys = captured["system"]
    assert 'ТОН (пресет "новостной дайджест")' in sys, "Новостной канал без стиля -> пресет дайджест"
    print("  unverified + пропуск (news) -> пресет 'новостной дайджест' ✓")


# ── 3. verified (обычный style_profile) -> стиль подмешан, без пресета ─────

async def test_verified_style_profile_mixed_in():
    generator._call_claude = _fake_call_claude
    generator._check_topic_match = _fake_topic_match

    ch = _make_channel(
        verified=True,
        style_profile="Тон: ироничный. Структура: короткие абзацы. Обращение: на ты.",
    )
    await generator.generate_post(ch)

    sys = captured["system"]
    assert "Профиль стиля:" in sys, "Обычный style_profile (анализ канала) должен подмешиваться"
    assert "ироничный" in sys, "Содержимое профиля должно попасть в промпт"
    assert "ТОН (пресет" not in sys, "При наличии профиля пресет не нужен"
    assert "ОБРАЗЦЫ СТИЛЯ АВТОРА" not in sys, "Профиль -- не образцы, зеркалирование не включается"
    print("  verified + style_profile -> стиль реального канала подмешан ✓")


# ── 4. Явный style тоже отключает пресет ────────────────────────────────────

async def test_manual_style_disables_preset():
    generator._call_claude = _fake_call_claude
    generator._check_topic_match = _fake_topic_match

    ch = _make_channel(style="Пиши коротко и дерзко")
    await generator.generate_post(ch)

    sys = captured["system"]
    assert "ТОН (пресет" not in sys, "Пользовательский style отключает пресет"
    assert "коротко и дерзко" in sys
    print("  ручной style отключает пресет тона ✓")


# ── Runner ─────────────────────────────────────────────────────────────────

async def main():
    print()
    tests = [
        test_samples_produce_mirror_block,
        test_skip_produces_tone_preset_thematic,
        test_skip_produces_tone_preset_news,
        test_verified_style_profile_mixed_in,
        test_manual_style_disables_preset,
    ]
    passed = failed = 0
    for t in tests:
        try:
            await t()
            passed += 1
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            failed += 1
    print(f"\n{'='*50}\nРезультат: {passed} прошли, {failed} упали")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
