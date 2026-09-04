import sys
import whisper

def main():
    if len(sys.argv) < 3:
        print("Usage: python transcribe.py audio.wav sortie.srt")
        sys.exit(1)

    audio = sys.argv[1]
    output = sys.argv[2]

    print("Chargement de Whisper...")

    model = whisper.load_model("base")

    print("Transcription en cours...")

    result = model.transcribe(
        audio,
        task="transcribe",
        fp16=False
    )

    with open(output, "w", encoding="utf-8") as f:
        for i, segment in enumerate(result["segments"], 1):
            start = segment["start"]
            end = segment["end"]
            text = segment["text"].strip()

            def timestamp(seconds):
                hours = int(seconds // 3600)
                minutes = int((seconds % 3600) // 60)
                secs = int(seconds % 60)
                millis = int(round((seconds - int(seconds)) * 1000))

                if millis >= 1000:
                    secs += 1
                    millis = 0

                return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

            f.write(f"{i}\n")
            f.write(f"{timestamp(start)} --> {timestamp(end)}\n")
            f.write(f"{text}\n\n")

    print("TRANSCRIPTION TERMINEE")
    print(f"Fichier : {output}")

if __name__ == "__main__":
    main()
