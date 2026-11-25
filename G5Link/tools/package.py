"""Builds dist/FS25_G5Link.zip (the mod, files at zip root as FS25 expects)
and dist/G5Link-PC.zip (bridge + web app, to copy to the gaming PC)."""
import pathlib, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)

def add_tree(z, src, arc_prefix=''):
    for f in sorted(src.rglob('*')):
        if f.is_file() and not f.name.startswith('.'):
            z.write(f, arc_prefix + f.relative_to(src).as_posix())

mod_zip = DIST / 'FS25_G5Link.zip'
with zipfile.ZipFile(mod_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    add_tree(z, ROOT / 'mod' / 'FS25_G5Link')

pc_zip = DIST / 'G5Link-PC.zip'
with zipfile.ZipFile(pc_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    add_tree(z, ROOT / 'bridge', 'G5Link/bridge/')
    add_tree(z, ROOT / 'app', 'G5Link/app/')
    z.write(ROOT / 'README.md', 'G5Link/README.md')

for p in (mod_zip, pc_zip):
    with zipfile.ZipFile(p) as z:
        print(p.name, p.stat().st_size, 'bytes:', ', '.join(z.namelist()))
