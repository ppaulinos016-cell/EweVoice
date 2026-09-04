import sys
import json
import math
import whisper
import numpy as np

audio_path = sys.argv[1]
language = sys.argv[2] if len(sys.argv) > 2 else "en"

LANG = {
    "eng_Latn": "en",
    "fra_Latn": "fr",
    "en": "en",
    "fr": "fr"
}
language = LANG.get(language, language)

print(json.dumps({
    "type": "start",
    "progress": 30,
    "stage": "transcription"
}), flush=True)

model = whisper.load_model("tiny")
audio = whisper.load_audio(audio_path)

sample_rate = 16000
chunk_seconds = 30
chunk_samples = chunk_seconds * sample_rate
total_samples = len(audio)
total_chunks = max(1, math.ceil(total_samples / chunk_samples))

all_segments = []

for index in range(total_chunks):
    start_sample = index * chunk_samples
    end_sample = min(total_samples, start_sample + chunk_samples)

    chunk = audio[start_sample:end_sample]
    offset = start_sample / sample_rate

    result = model.transcribe(
        chunk,
        language=language,
        task="transcribe",
        fp16=False,
        condition_on_previous_text=False,
        verbose=False
    )

    new_segments = []

    for seg in result.get("segments", []):
        start = round(seg["start"] + offset, 3)
        end = round(seg["end"] + offset, 3)
        text = seg["text"].strip()

        if text:
            item = {
                "id": len(all_segments) + len(new_segments) + 1,
                "start": start,
                "end": end,
                "text": text
            }
            new_segments.append(item)

    all_segments.extend(new_segments)

    progress = 30 + int(((index + 1) / total_chunks) * 65)

    print(json.dumps({
        "type": "progress",
        "progress": min(progress, 95),
        "stage": "transcription",
        "segments": new_segments
    }, ensure_ascii=False), flush=True)

print(json.dumps({
    "type": "complete",
    "progress": 100,
    "stage": "complete",
    "segments": all_segments
}, ensure_ascii=False), flush=True)
