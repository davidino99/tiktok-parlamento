"""Sintesi vocale gratuita e locale (Kokoro o Piper), per tutte le frasi di un episodio in una volta.

    python scripts/voce-locale.py richiesta.json

richiesta.json: {"motore": "kokoro"|"piper", "voce": "...", "velocita": 1.1,
                 "frasi": [{"testo": "...", "file": "uscita.wav"}, ...]}
"""
import json
import os
import subprocess
import sys

richiesta = json.load(open(sys.argv[1], encoding="utf-8"))
motore, voce = richiesta["motore"], richiesta["voce"]
velocita = float(richiesta.get("velocita", 1.0))
frasi = richiesta["frasi"]

if motore == "kokoro":
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code="i")
    for f in frasi:
        pezzi = [audio for _, _, audio in pipeline(f["testo"], voice=voce, speed=velocita)]
        sf.write(f["file"], np.concatenate(pezzi), 24000)
        print("✔", os.path.basename(f["file"]))

elif motore == "piper":
    dati = os.environ.get("VOCI_PIPER", "voci-piper")
    if not os.path.exists(os.path.join(dati, voce + ".onnx")):
        subprocess.run([sys.executable, "-m", "piper.download_voices", voce, "--data-dir", dati], check=True)
    for f in frasi:
        subprocess.run([sys.executable, "-m", "piper", "-m", voce, "--data-dir", dati,
                        "--length-scale", str(round(1 / velocita, 3)), "-f", f["file"], "--", f["testo"]], check=True)
        print("✔", os.path.basename(f["file"]))

else:
    sys.exit(f"Motore sconosciuto: {motore}")
