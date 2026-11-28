"""Build and verify the FS25 mod and matching PC bridge and display."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from tempfile import TemporaryDirectory
from xml.etree import ElementTree
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
MOD = ROOT / 'mod' / 'FS25_G5Link'


def file_tree(directory, prefix=''):
    files = {}
    for file in sorted(directory.rglob('*')):
        rel = file.relative_to(directory)
        if file.is_file() and not any(part.startswith('.') or part in {'__pycache__', 'node_modules'} for part in rel.parts):
            if file.suffix not in {'.tmp', '.pyc'}:
                files[prefix + rel.as_posix()] = file.read_bytes()
    return files


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def write_archive(path, files):
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            member = PurePosixPath(name)
            if member.is_absolute() or '..' in member.parts or '\\' in name or ':' in name:
                raise ValueError(f'Unsafe archive path {name}')
            archive.writestr(ZipInfo(name), content, compress_type=ZIP_DEFLATED)
    with ZipFile(path) as archive:
        if archive.testzip() or set(archive.namelist()) != set(files):
            raise IOError(f'Invalid archive contents in {path.name}')
        for name, content in files.items():
            if archive.read(name) != content:
                raise IOError(f'Archive differs from source at {name}')


def build(output):
    output.mkdir(parents=True, exist_ok=True)
    mod = file_tree(MOD)
    pc = file_tree(ROOT / 'bridge', 'G5Link/bridge/') | file_tree(ROOT / 'app', 'G5Link/app/')
    pc['G5Link/README.md'] = (ROOT / 'README.md').read_bytes()
    desc = ElementTree.fromstring(mod['modDesc.xml'])
    for item in desc.findall('./extraSourceFiles/sourceFile'):
        if item.attrib['filename'] not in mod:
            raise IOError(f'Missing Lua source {item.attrib["filename"]}')
    telemetry = re.search(rb'G5Link\.VERSION = "([0-9.]+)"', mod['scripts/G5Link.lua']).group(1).decode()
    bridge = re.search(rb"BRIDGE_VERSION = '([0-9.]+)'", pc['G5Link/bridge/g5link-bridge.js']).group(1).decode()
    release = desc.findtext('version')
    if bridge != release:
        raise ValueError('The bridge and FS25 mod package versions must match.')
    manifest = {'version': release, 'telemetryVersion': telemetry,
                'modFiles': {name: sha256(value) for name, value in mod.items()},
                'pcFiles': {name: sha256(value) for name, value in pc.items()}}
    pc['G5Link/manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    with TemporaryDirectory(prefix='g5link-package-', dir=output) as stage:
        stage = Path(stage)
        artifacts = {'FS25_G5Link.zip': mod, 'G5Link-PC.zip': pc}
        for name, files in artifacts.items():
            write_archive(stage / name, files)
        sums = {name: sha256((stage / name).read_bytes()) for name in artifacts}
        checksums = 'G5Link-SHA256.txt'
        (stage / checksums).write_text(''.join(f'{digest}  {name}\n' for name, digest in sums.items()), encoding='ascii')
        for name in [*artifacts, checksums]:
            (stage / name).replace(output / name)
            print(f'{name} · {(output / name).stat().st_size:,} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist', help='Directory for the verified release files')
    build(parser.parse_args().output.resolve())
