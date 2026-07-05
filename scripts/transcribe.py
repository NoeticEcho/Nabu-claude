#!/usr/bin/env python3
"""Локальный воркер транскрипции для Nabu-claude (faster-whisper).

Тяжёлая операция выполняется ЛОКАЛЬНО — аудио не уходит в облако/Claude. Печатает JSON
в stdout: {"ok": true, "text": ..., "language": ..., "segments": N} или {"ok": false, "error": ...}.

Использование: python3 transcribe.py <audio_path> [model] [language]
  model    — faster-whisper модель (по умолчанию large-v3)
  language — код языка или 'auto'
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "не задан путь к аудио"}))
        return 2
    audio = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
    language = sys.argv[3] if len(sys.argv) > 3 else "auto"

    import os
    # Проверки файла ДО тяжёлого импорта модели (не платим за импорт, если файла нет/он огромен).
    if not os.path.exists(audio):
        print(json.dumps({"ok": False, "error": f"файл не найден: {audio}"}))
        return 4
    max_bytes = int(os.environ.get("NABU_MAX_AUDIO_BYTES", str(500 * 1024 * 1024)))
    try:
        size = os.path.getsize(audio)
    except OSError as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"не удалось прочитать файл: {exc}"}))
        return 4
    if size > max_bytes:
        print(json.dumps({
            "ok": False,
            "error": f"файл слишком большой ({size} b > лимит {max_bytes} b)",
            "hint": "увеличьте NABU_MAX_AUDIO_BYTES или разбейте аудио на части",
        }))
        return 6

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({
            "ok": False,
            "error": f"faster-whisper не установлен: {exc}",
            "hint": "uv-venv с faster-whisper не готов (Nabu ставит его автоматически при первом голосовом)",
        }))
        return 3

    try:
        model = WhisperModel(model_name, device="auto", compute_type="int8")
        segments, info = model.transcribe(
            audio,
            language=None if language == "auto" else language,
        )
        parts = []
        for seg in segments:
            parts.append(seg.text)
        text = "".join(parts).strip()
        print(json.dumps({
            "ok": True,
            "text": text,
            "language": info.language,
            "segments": len(parts),
        }, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 5


if __name__ == "__main__":
    sys.exit(main())
