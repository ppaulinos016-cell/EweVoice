import sys
import re
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL_NAME = "facebook/nllb-200-distilled-600M"

def parse_srt(path):
    text = open(path, "r", encoding="utf-8-sig").read()
    blocks = re.split(r"\n\s*\n", text.strip())
    results = []

    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3:
            continue

        parts = lines[1].split(" --> ")
        if len(parts) != 2:
            continue

        results.append((parts[0], parts[1], " ".join(lines[2:]).strip()))

    return results

def main():
    if len(sys.argv) < 4:
        print("Usage: python translate_srt.py input.srt output.srt langue")
        sys.exit(1)

    input_srt, output_srt, target = sys.argv[1:4]

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

    tokenizer.src_lang = "eng_Latn"

    target_id = tokenizer.convert_tokens_to_ids(
        "fra_Latn" if target == "fr" else "ewe_Latn"
    )

    segments = parse_srt(input_srt)
    output = []

    for i, (start, end, text) in enumerate(segments, 1):
        print(f"TRADUCTION {i}/{len(segments)}", flush=True)

        inputs = tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=512
        )

        result = model.generate(
            **inputs,
            forced_bos_token_id=target_id,
            max_length=512
        )

        translated = tokenizer.decode(
            result[0],
            skip_special_tokens=True
        )

        output.append(
            f"{i}\n{start} --> {end}\n{translated}\n"
        )

    with open(output_srt, "w", encoding="utf-8") as f:
        f.write("\n".join(output))

    print("TRADUCTION TERMINEE", flush=True)

if __name__ == "__main__":
    main()
