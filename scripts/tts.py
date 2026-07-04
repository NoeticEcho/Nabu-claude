#!/usr/bin/env python3
"""Локальный синтез речи для Nabu-claude (piper-tts).

Тяжёлая операция выполняется ЛОКАЛЬНО — текст не уходит в облако/Claude. Печатает в stdout
две служебные строки для вызывающего: "OGG: <path>" (или "OGG: none") и "WAV: <path>".
Диагностика и подсказки — в stderr.

Использование: python3 tts.py (--text "..." | --file <txt>) [--voice <model>] [--out <path.wav>]
  --voice  — имя голоса piper (по умолчанию env NABU_TTS_VOICE, иначе ru_RU-irina-medium)
  --out    — путь к .wav (по умолчанию временный файл)
Голоса скачиваются один раз в ~/.nabu/tts-voices. Нужен ffmpeg в PATH для формата голосовых (.ogg/opus).
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

MAX_CHARS = 3000


def main() -> int:
    ap = argparse.ArgumentParser(add_help=True)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--text")
    src.add_argument("--file")
    ap.add_argument("--voice", default=os.environ.get("NABU_TTS_VOICE", "ru_RU-irina-medium"))
    ap.add_argument("--out")
    args = ap.parse_args()

    # Читаем и режем вход ДО тяжёлого импорта модели (не платим за импорт впустую).
    if args.file:
        if not os.path.exists(args.file):
            print(f"файл не найден: {args.file}", file=sys.stderr)
            return 4
        with open(args.file, encoding="utf-8") as fh:
            text = fh.read().strip()
    else:
        text = (args.text or "").strip()
    if not text:
        print("пустой текст", file=sys.stderr)
        return 2
    if len(text) > MAX_CHARS:
        print(f"TRUNCATED: озвучены первые {MAX_CHARS} из {len(text)} символов", file=sys.stderr)
        text = text[:MAX_CHARS]

    voices_dir = os.path.expanduser("~/.nabu/tts-voices")
    os.makedirs(voices_dir, exist_ok=True)
    onnx = os.path.join(voices_dir, f"{args.voice}.onnx")
    if not os.path.exists(onnx):
        print(f"скачиваю голос {args.voice}…", file=sys.stderr)
        dl = subprocess.run(
            [sys.executable, "-m", "piper.download_voices", args.voice, "--data-dir", voices_dir],
            capture_output=True, text=True,
        )
        if dl.returncode != 0 or not os.path.exists(onnx):
            print(f"не удалось скачать голос '{args.voice}': {dl.stderr.strip()}", file=sys.stderr)
            print("hint: проверьте имя голоса (python3 -m piper.download_voices) и сеть", file=sys.stderr)
            return 7

    try:
        from piper import PiperVoice
    except Exception as exc:  # noqa: BLE001
        print(f"piper-tts не установлен: {exc}", file=sys.stderr)
        print("hint: pip install piper-tts", file=sys.stderr)
        return 3

    out_wav = args.out or tempfile.mkstemp(prefix="nabu-tts-", suffix=".wav")[1]
    try:
        import wave
        voice = PiperVoice.load(onnx)
        with wave.open(out_wav, "wb") as wav_file:
            voice.synthesize_wav(text, wav_file)
    except Exception as exc:  # noqa: BLE001
        print(f"синтез не удался: {exc}", file=sys.stderr)
        return 5

    # Голосовые заметки Telegram — ogg/opus; если ffmpeg есть, отдаём и его.
    if shutil.which("ffmpeg"):
        out_ogg = os.path.splitext(out_wav)[0] + ".ogg"
        conv = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", out_wav, "-c:a", "libopus", "-b:a", "32k", out_ogg],
            capture_output=True, text=True,
        )
        print(f"OGG: {out_ogg}" if conv.returncode == 0 and os.path.exists(out_ogg) else "OGG: none")
    else:
        print("OGG: none")
    print(f"WAV: {out_wav}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
