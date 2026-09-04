import sys
import os
import re
import numpy as np
import soundfile as sf
import torch
from transformers import VitsModel, AutoTokenizer

MODEL_DIR = "models/mms-tts-ewe"

def parse_srt(path):
    text = open(path, "r", encoding="utf-8-sig").read()
    blocks = re.split(r"\n\s*\n", text.strip())
    segments = []

    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3:
            continue

        timing = lines[1]
        match = re.match(
            r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})",
            timing
        )

        if not match:
            continue

        v = list(map(int, match.groups()))

        start = v[0]*3600 + v[1]*60 + v[2] + v[3]/1000
        end = v[4]*3600 + v[5]*60 + v[6] + v[7]/1000

        subtitle = " ".join(lines[2:]).strip()

        if subtitle:
            segments.append((start, end, subtitle))

    return segments


def main():
    if len(sys.argv) < 2:
        print("Usage: python dub_ewe.py fichier.srt [sortie.wav]")
        sys.exit(1)

    srt_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "outputs/ewe-dub.wav"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    print("Chargement du modèle TTS Éwé...")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = VitsModel.from_pretrained(MODEL_DIR)

    sample_rate = model.config.sampling_rate

    segments = parse_srt(srt_path)

    if not segments:
        raise RuntimeError("Aucun segment SRT trouvé.")

    total_duration = max(end for _, end, _ in segments)

    final_audio = np.zeros(
        int((total_duration + 1) * sample_rate),
        dtype=np.float32
    )

    print(f"{len(segments)} segments à générer.")

    for index, (start, end, text) in enumerate(segments, 1):

        print(f"[{index}/{len(segments)}] {text}")

        inputs = tokenizer(
            text,
            return_tensors="pt"
        )

        with torch.no_grad():
            waveform = model(**inputs).waveform

        audio = waveform.squeeze().cpu().numpy()

        max_duration = end - start
        max_samples = int(max_duration * sample_rate)

        if len(audio) > max_samples:
            audio = audio[:max_samples]

        position = int(start * sample_rate)

        available = len(final_audio) - position
        length = min(len(audio), available)

        if length > 0:
            final_audio[position:position+length] += audio[:length]

    peak = np.max(np.abs(final_audio))

    if peak > 0.95:
        final_audio = final_audio / peak * 0.95

    sf.write(
        output_path,
        final_audio,
        sample_rate
    )

    print("")
    print("=================================")
    print("DOUBLAGE EWE AUDIO TERMINE")
    print("=================================")
    print(f"Fichier : {output_path}")


if __name__ == "__main__":
    main()
