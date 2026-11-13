"""Produit la page à publier en Artifact claude.ai : retire l'enveloppe doctype/html/head/body
(la plateforme ajoute la sienne) en gardant title, meta, liens et contenu. Usage : python3 tools/artifact-page.py > /tmp/page.html"""
import re, sys, pathlib
src = pathlib.Path(__file__).resolve().parent.parent / 'app' / 'index.html'
s = src.read_text(encoding='utf-8')
s = re.sub(r'<!doctype html>\s*', '', s, flags=re.I)
s = re.sub(r'</?html[^>]*>\s*', '', s, flags=re.I)
s = re.sub(r'</?head>\s*', '', s, flags=re.I)
s = re.sub(r'</?body[^>]*>\s*', '', s, flags=re.I)
s = re.sub(r'<meta charset[^>]*>\s*', '', s, flags=re.I)
s = re.sub(r'<meta name="viewport"[^>]*>\s*', '', s, flags=re.I)
sys.stdout.write(s)
