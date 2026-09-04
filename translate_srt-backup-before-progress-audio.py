import sys
import os
import re

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

        time_line_index = 1

        if "-->" not in lines[time_line_index]:
            time_line_index = 0

        if "-->" not in lines[time_line_index]:
            continue

        times = lines[time_line_index].split("-->")

        if len(times) != 2:
            continue

        start = times[0].strip()
        end = times[1].strip()

        text = " ".join(
            lines[time_line_index + 1:]
        ).strip()

        result.append({
            "id": index,
            "start": start,
            "end": end,
            "text": text
        })

    return result


def blocks_to_srt(blocks):

    output = []

    for i, block in enumerate(blocks, 1):

        output.append(
            str(i)
        )

        output.append(
            f"{block['start']} --> {block['end']}"
        )

        output.append(
            block["text"]
        )

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

    translated = tokenizer.batch_decode(
        generated_tokens,
        skip_special_tokens=True
    )[0]

    return translated.strip()


def main():

    if len(sys.argv) < 3:

        print(
            "Usage: python translate_srt.py "
            "input.srt output.srt [source] [target]"
        )

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

    source = LANGUAGE_MAP.get(
        source,
        source
    )

    target = LANGUAGE_MAP.get(
        target,
        target
    )

    print("========================================")
    print("TRADUCTION SRT")
    print("========================================")
    print(f"Source : {source}")
    print(f"Cible  : {target}")
    print()

    if not os.path.exists(input_file):

        print(
            f"ERREUR : fichier introuvable : {input_file}"
        )

        sys.exit(1)

    with open(
        input_file,
        "r",
        encoding="utf-8"
    ) as f:

        content = f.read()

    blocks = srt_to_blocks(content)

    if not blocks:

        print(
            "ERREUR : aucun segment SRT trouvé."
        )

        sys.exit(1)

    print(
        f"{len(blocks)} segment(s) à traduire."
    )

    print()
    print(
        "Chargement du modèle NLLB..."
    )

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_NAME
    )

    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_NAME
    )

    translated_blocks = []

    for number, block in enumerate(
        blocks,
        1
    ):

        print(
            f"Traduction {number}/{len(blocks)}..."
        )

        try:

            translated_text = translate_text(
                model,
                tokenizer,
                block["text"],
                source,
                target
            )

        except Exception as error:

            print(
                f"Erreur segment {number} : {error}"
            )

            translated_text = block["text"]

        translated_blocks.append({

            "id": block["id"],

            "start": block["start"],

            "end": block["end"],

            "text": translated_text
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

    print()
    print("========================================")
    print("TRADUCTION TERMINEE")
    print("========================================")
    print(f"Fichier : {output_file}")


if __name__ == "__main__":
    main()
