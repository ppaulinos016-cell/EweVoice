import sys
import torch
import soundfile as sf
from transformers import VitsModel, AutoTokenizer

MODEL_DIR = "models/mms-tts-ewe"

if len(sys.argv) < 2:
    print("Usage: python tts_ewe.py \"texte Ewe\" [sortie.wav]")
    sys.exit(1)

text = sys.argv[1]
output = sys.argv[2] if len(sys.argv) >= 3 else "outputs/voice_ewe.wav"

tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
model = VitsModel.from_pretrained(MODEL_DIR)

inputs = tokenizer(text, return_tensors="pt")

with torch.no_grad():
    output_waveform = model(**inputs).waveform

audio = output_waveform.squeeze().cpu().numpy()

sf.write(
    output,
    audio,
    model.config.sampling_rate
)

print(f"VOIX EWE CREEE : {output}")
