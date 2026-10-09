"""Folha de revisão de um reel: um quadro a cada N segundos, lado a lado."""
import os, subprocess, sys, glob
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tutoriais", "motor"))
from motor import FF
from PIL import Image
video, passo = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
tmp = video + ".q"; os.makedirs(tmp, exist_ok=True)
for f in glob.glob(os.path.join(tmp, "*.png")): os.remove(f)
subprocess.run([FF, "-loglevel", "error", "-i", video, "-vf", f"fps=1/{passo},scale=270:480", os.path.join(tmp, "%03d.png")], check=True)
fs = sorted(glob.glob(os.path.join(tmp, "*.png"))); cols = 8; rows = (len(fs) + cols - 1) // cols
img = Image.new("RGB", (270 * cols, 480 * rows), "white")
for i, f in enumerate(fs): img.paste(Image.open(f), ((i % cols) * 270, (i // cols) * 480))
saida = video.replace(".mp4", ".folha.png"); img.save(saida); print(saida, len(fs), "quadros")
