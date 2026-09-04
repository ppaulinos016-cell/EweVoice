import sys
import os
import re
import json

from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL_NAME = "facebook/nllb-200-distilled-600M"

LANGUAGE_MAP = {
    "eng_Latn": "eng_Latn",
    "fra_Latn": "fra_Latn",
    "en": "eng_Latn",
    "fr": "fra_Latn",
    "ewe": "ewe_Latn",
    "ewe_Latn": "ewe_Latn"
}


def srt_to_blocks(content):
    content = content.replace("\r", "").strip()

    if not content:
        return []

    blocks = re.split(r"\n\s*\n", content)
    result = []

    for block in blocks:
        lines = block.split("\n")

        if len(lines) < 3:
            continue

        index = lines[0].strip()

        if "-->" not in lines[1]:
            continue

        times = lines[1].split("-->")

        if len(times) != 2:
            continue

        result.append({
            "id": index,
            "start": times[0].strip(),
            "end": times[1].strip(),
            "text": " ".join(lines[2:]).strip()
        })

    return result


def blocks_to_srt(blocks):
    output = []

    for i, block in enumerate(blocks, 1):
        output.append(str(i))
        output.append(
            f"{block['start']} --> {block['end']}"
        )
        output.append(block["text"])
        output.append("")

    return "\n".join(output)


def translate_text(
    model,
    tokenizer,
    text,
    source_language,
    target_language
):
    text = text.strip()

    if not text:
        return ""

    tokenizer.src_lang = source_language

    encoded = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512
    )

    generated_tokens = model.generate(
        **encoded,
        forced_bos_token_id=
            tokenizer.convert_tokens_to_ids(
                target_language
            ),
        max_length=512,
        num_beams=4
    )

    return tokenizer.batch_decode(
        generated_tokens,
        skip_special_tokens=True
    )[0].strip()


def emit(data):
    print(
        json.dumps(
            data,
            ensure_ascii=False
        ),
        flush=True
    )


def main():

    if len(sys.argv) < 3:
        emit({
            "type": "error",
            "error": "Arguments insuffisants."
        })
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    source = (
        sys.argv[3]
        if len(sys.argv) >= 4
        else "eng_Latn"
    )

    target = (
        sys.argv[4]
        if len(sys.argv) >= 5
        else "ewe_Latn"
    )

    source = LANGUAGE_MAP.get(source, source)
    target = LANGUAGE_MAP.get(target, target)

    if not os.path.exists(input_file):
        emit({
            "type": "error",
            "error": "Fichier SRT introuvable."
        })
        sys.exit(1)

    with open(
        input_file,
        "r",
        encoding="utf-8"
    ) as f:
        content = f.read()

    blocks = srt_to_blocks(content)

    if not blocks:
        emit({
            "type": "error",
            "error": "Aucun segment SRT trouvé."
        })
        sys.exit(1)

    emit({
        "type": "start",
        "progress": 5,
        "stage": "loading_model",
        "total": len(blocks)
    })

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_NAME
    )

    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_NAME
    )

    translated_blocks = []

    for number, block in enumerate(blocks, 1):

        try:
            translated_text = translate_text(
                model,
                tokenizer,
                block["text"],
                source,
                target
            )

        except Exception as error:

            translated_text = block["text"]

            emit({
                "type": "segment_error",
                "segment": number,
                "error": str(error)
            })

        translated_block = {
            "id": int(block["id"])
                if str(block["id"]).isdigit()
                else number,
            "start": block["start"],
            "end": block["end"],
            "text": translated_text
        }

        translated_blocks.append(
            translated_block
        )

        progress = 10 + int(
            (number / len(blocks)) * 90
        )

        emit({
            "type": "progress",
            "progress": min(progress, 99),
            "stage": "translation",
            "segment": number,
            "total": len(blocks),
            "subtitle": translated_block
        })

    output_srt = blocks_to_srt(
        translated_blocks
    )

    output_directory = os.path.dirname(
        os.path.abspath(output_file)
    )

    os.makedirs(
        output_directory,
        exist_ok=True
    )

    with open(
        output_file,
        "w",
        encoding="utf-8"
    ) as f:
        f.write(output_srt)

    emit({
        "type": "complete",
        "progress": 100,
        "stage": "complete",
        "segments": translated_blocks
    })


if __name__ == "__main__":
    main()
