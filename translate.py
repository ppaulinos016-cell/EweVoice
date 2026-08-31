import sys
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL_NAME = "facebook/nllb-200-distilled-600M"

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

def translate(text):
    tokenizer.src_lang = "eng_Latn"

    inputs = tokenizer(
        text,
        return_tensors="pt",
        padding=True,
        truncation=True
    )

    forced_bos_token_id = tokenizer.convert_tokens_to_ids("ewe_Latn")

    translated_tokens = model.generate(
        **inputs,
        forced_bos_token_id=forced_bos_token_id,
        max_length=256
    )

    return tokenizer.batch_decode(
        translated_tokens,
        skip_special_tokens=True
    )[0]

if __name__ == "__main__":
    text = " ".join(sys.argv[1:]).strip()

    if not text:
        print("Texte anglais manquant.", file=sys.stderr)
        sys.exit(1)

    print(translate(text))
