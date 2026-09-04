import sys
import os
import json
import subprocess
import tempfile
import shutil
import torch
import soundfile as sf
from transformers import VitsModel, AutoTokenizer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models", "mms-tts-ewe")

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
        raise RuntimeError(
            result.stderr or result.stdout or "Erreur FFmpeg"
        )

    return result.stdout.strip()

def duration(path):
    output = run([
        "ffprobe",
        "-v", "error",
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
        "ffmpeg",
        "-y",
        "-i", source,
        "-af", filter_chain,
        "-t", f"{target_duration:.3f}",
        "-ar", "44100",
        "-ac", "2",
        target
    ])

def create_silence(path, seconds):

    if seconds <= 0:
        return

    run([
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=stereo",
        "-t", f"{seconds:.3f}",
        "-ar", "44100",
        "-ac", "2",
        path
    ])

def generate_tts(model, tokenizer, text, output):

    inputs = tokenizer(
        text,
        return_tensors="pt"
    )

    with torch.no_grad():
        waveform = model(**inputs).waveform

    audio = waveform.squeeze().cpu().numpy()

    sf.write(
        output,
        audio,
        model.config.sampling_rate
    )

def make_timeline(segments, output, total_duration):

    work = tempfile.mkdtemp(prefix="ewevoice_")

    try:

        print(json.dumps({
            "type": "start",
            "progress": 50,
            "stage": "loading_ewe_model",
            "total": len(segments)
        }, ensure_ascii=False), flush=True)

        print(
            "Chargement du modele Ewe...",
            file=sys.stderr,
            flush=True
        )

        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_DIR
        )

        model = VitsModel.from_pretrained(
            MODEL_DIR
        )

        model.eval()

        print(
            "Modele Ewe charge.",
            file=sys.stderr,
            flush=True
        )

        pieces = []
        current = 0.0

        valid_segments = [
            s for s in segments
            if str(s.get("text", "")).strip()
        ]

        total = len(valid_segments)

        if total == 0:
            raise RuntimeError(
                "Aucun segment audio Ewe."
            )

        for index, segment in enumerate(valid_segments):

            start = float(segment["start"])
            end = float(segment["end"])

            text = str(
                segment.get("text", "")
            ).strip()

            segment_duration = max(
                0.05,
                end - start
            )

            raw = os.path.join(
                work,
                f"raw_{index}.wav"
            )

            adjusted = os.path.join(
                work,
                f"adjusted_{index}.wav"
            )

            generate_tts(
                model,
                tokenizer,
                text,
                raw
            )

            adjust_audio(
                raw,
                adjusted,
                segment_duration
            )

            gap = max(
                0.0,
                start - current
            )

            if gap > 0:

                silence = os.path.join(
                    work,
                    f"silence_{index}.wav"
                )

                create_silence(
                    silence,
                    gap
                )

                pieces.append(
                    silence
                )

            pieces.append(
                adjusted
            )

            current = max(
                current,
                end
            )

            progress = 50 + int(
                ((index + 1) / total) * 45
            )

            print(json.dumps({
                "type": "progress",
                "progress": min(progress, 95),
                "stage": "generating_ewe_audio",
                "segment": index + 1,
                "total": total
            }, ensure_ascii=False), flush=True)

        trailing = max(
            0.0,
            total_duration - current
        )

        if trailing > 0:

            silence = os.path.join(
                work,
                "trailing_silence.wav"
            )

            create_silence(
                silence,
                trailing
            )

            pieces.append(
                silence
            )

        concat_file = os.path.join(
            work,
            "concat.txt"
        )

        with open(
            concat_file,
            "w",
            encoding="utf-8"
        ) as f:

            for piece in pieces:

                safe = (
                    piece
                    .replace("\\", "/")
                    .replace("'", "'\\''")
                )

                f.write(
                    f"file '{safe}'\n"
                )

        run([
            "ffmpeg",
            "-y",
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

        print(json.dumps({
            "type": "complete",
            "progress": 100,
            "stage": "complete",
            "output": output,
            "duration": total_duration
        }, ensure_ascii=False), flush=True)

    finally:

        shutil.rmtree(
            work,
            ignore_errors=True
        )

def main():

    if len(sys.argv) < 4:

        print(
            "Usage: python dub_ewe.py segments.json output.mp3 total_duration"
        )

        sys.exit(1)

    segments_file = sys.argv[1]
    output = sys.argv[2]
    total_duration = float(sys.argv[3])

    with open(
        segments_file,
        "r",
        encoding="utf-8"
    ) as f:

        segments = json.load(f)

    make_timeline(
        segments,
        output,
        total_duration
    )

if __name__ == "__main__":
    main()
