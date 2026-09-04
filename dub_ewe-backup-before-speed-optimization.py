import sys
import os
import json
import subprocess
import tempfile
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON = os.path.join(BASE_DIR, ".venv", "Scripts", "python.exe")
TTS = os.path.join(BASE_DIR, "tts_ewe.py")

def run(command):
    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or "Erreur inconnue")
    return result.stdout.strip()

def duration(path):
    output = run([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path
    ])
    return float(output)

def tempo_filter(ratio):
    filters = []

    while ratio > 2.0:
        filters.append("atempo=2.0")
        ratio /= 2.0

    while ratio < 0.5:
        filters.append("atempo=0.5")
        ratio /= 0.5

    filters.append(f"atempo={ratio:.6f}")
    return ",".join(filters)

def adjust_audio(source, target, target_duration):
    actual = duration(source)

    if actual <= 0:
        raise RuntimeError("Audio TTS vide.")

    ratio = actual / target_duration

    filter_chain = tempo_filter(ratio)

    run([
        "ffmpeg", "-y",
        "-i", source,
        "-af", filter_chain,
        "-t", f"{target_duration:.3f}",
        "-ar", "44100",
        "-ac", "2",
        target
    ])

    actual_after = duration(target)

    if actual_after < target_duration:
        run([
            "ffmpeg", "-y",
            "-i", target,
            "-af", f"apad=pad_dur={target_duration - actual_after:.3f}",
            "-t", f"{target_duration:.3f}",
            "-ar", "44100",
            "-ac", "2",
            target + ".pad.wav"
        ])
        os.replace(target + ".pad.wav", target)

def make_timeline(segments, output, total_duration):
    work = tempfile.mkdtemp(prefix="ewevoice_")

    try:
        pieces = []
        current = 0.0

        for index, segment in enumerate(segments):
            start = float(segment["start"])
            end = float(segment["end"])
            text = str(segment.get("text", "")).strip()

            if not text:
                continue

            segment_duration = max(0.05, end - start)

            raw = os.path.join(work, f"raw_{index}.wav")
            adjusted = os.path.join(work, f"adjusted_{index}.wav")

            run([
                PYTHON,
                TTS,
                text,
                raw
            ])

            adjust_audio(raw, adjusted, segment_duration)

            gap = max(0.0, start - current)

            if gap > 0:
                silence = os.path.join(work, f"silence_{index}.wav")

                run([
                    "ffmpeg", "-y",
                    "-f", "lavfi",
                    "-i", "anullsrc=r=44100:cl=stereo",
                    "-t", f"{gap:.3f}",
                    "-ar", "44100",
                    "-ac", "2",
                    silence
                ])

                pieces.append(silence)

            pieces.append(adjusted)
            current = max(current, end)

        if not pieces:
            raise RuntimeError("Aucun segment audio Éwé n'a été généré.")

        concat_file = os.path.join(work, "concat.txt")

        with open(concat_file, "w", encoding="utf-8") as f:
            for piece in pieces:
                safe = piece.replace("\\", "/").replace("'", "'\\''")
                f.write(f"file '{safe}'\n")

        run([
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_file,
            "-t", f"{total_duration:.3f}",
            "-ar", "44100",
            "-ac", "2",
            "-c:a", "libmp3lame",
            "-b:a", "192k",
            output
        ])

    finally:
        shutil.rmtree(work, ignore_errors=True)

def main():
    if len(sys.argv) < 4:
        print("Usage: python dub_ewe.py segments.json output.mp3 total_duration")
        sys.exit(1)

    segments_file = sys.argv[1]
    output = sys.argv[2]
    total_duration = float(sys.argv[3])

    with open(segments_file, "r", encoding="utf-8") as f:
        segments = json.load(f)

    make_timeline(
        segments,
        output,
        total_duration
    )

    print(json.dumps({
        "success": True,
        "output": output,
        "duration": total_duration
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
