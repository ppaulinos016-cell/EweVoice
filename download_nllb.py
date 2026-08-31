from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL_NAME = "facebook/nllb-200-distilled-600M"

print("Téléchargement du tokenizer...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

print("Téléchargement du modèle NLLB...")
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)

print("NLLB installé avec succès.")
