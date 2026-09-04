import sys
import json
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL_NAME = "facebook/nllb-200-distilled-600M"

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

tokenizer.src_lang = "eng_Latn"

def translate(text):
    inputs = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512
    )

    translated = model.generate(
        **inputs,
        forced_bos_token_id=tokenizer.convert_tokens_to_ids("ewe_Latn"),
        max_length=512
    )

    return tokenizer.decode(
        translated[0],
        skip_special_tokens=True
    )

data = json.load(sys.stdin)

results = []

for item in data:
    results.append({
        "start": item["start"],
        "end": item["end"],
        "text": translate(item["text"])
    })

print(json.dumps(results, ensure_ascii=False))
