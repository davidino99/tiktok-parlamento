"""Genera campioni delle voci gratuite (Kokoro e Piper) per sceglierne una.

    python scripts/prova-voci.py uscita/prova-voci
"""
import os
import subprocess
import sys

TESTO = (
    "Nel 1959 nove escursionisti esperti muoiono sui monti Urali. "
    "E la loro tenda è tagliata… dall'interno. "
    "Lo sapevi che gli squali esistono da prima degli alberi? "
    "Quale ti ha sorpreso di più? Scrivilo nei commenti."
)

cartella = sys.argv[1] if len(sys.argv) > 1 else "uscita/prova-voci"
os.makedirs(cartella, exist_ok=True)


def in_mp3(wav, nome):
    mp3 = os.path.join(cartella, nome + ".mp3")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-b:a", "160k", mp3], check=True)
    os.remove(wav)
    print("✔", mp3)


# --- Kokoro (Apache 2.0): voci italiane if_sara (femminile) e im_nicola (maschile)
try:
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code="i")
    for voce in ["if_sara", "im_nicola"]:
        for velocita in [1.0, 1.15]:
            pezzi = [audio for _, _, audio in pipeline(TESTO, voice=voce, speed=velocita)]
            wav = os.path.join(cartella, "tmp.wav")
            sf.write(wav, np.concatenate(pezzi), 24000)
            in_mp3(wav, f"kokoro-{voce}-velocita-{velocita}")
except Exception as e:  # noqa: BLE001
    print("✖ Kokoro:", e)

# --- Piper: voci italiane paola (femminile) e riccardo (maschile)
for voce in ["it_IT-paola-medium", "it_IT-riccardo-x_low"]:
    try:
        subprocess.run([sys.executable, "-m", "piper.download_voices", voce, "--data-dir", "voci-piper"], check=True)
        wav = os.path.join(cartella, "tmp.wav")
        subprocess.run([sys.executable, "-m", "piper", "-m", voce, "--data-dir", "voci-piper", "-f", wav, "--", TESTO], check=True)
        in_mp3(wav, f"piper-{voce}")
    except Exception as e:  # noqa: BLE001
        print("✖ Piper", voce, e)
