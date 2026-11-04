#!/usr/bin/env python3
"""Build the submission ZIP without dependencies, caches, keys or local Git state."""
from pathlib import Path
import hashlib
import os
import zipfile

root = Path(__file__).resolve().parents[1]
archive = root.parent / 'AMM_DEX作业_完整材料.zip'
excluded = {'.git', 'node_modules', 'artifacts', 'cache', 'typechain-types', 'dist', '__pycache__'}
files = []
for current, dirs, names in os.walk(root):
    dirs[:] = sorted(d for d in dirs if d not in excluded)
    for name in sorted(names):
        path = Path(current) / name
        if name in {'.DS_Store', 'SHA256SUMS.txt'} or name.endswith(('.zip', '.pyc', '.log')):
            continue
        if name.startswith('.env') and name != '.env.example':
            continue
        if path.is_symlink():
            raise RuntimeError(f'Unexpected symlink: {path}')
        files.append(path)
files.sort()
checksums = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
manifest = root / 'SHA256SUMS.txt'
manifest.write_text(''.join(f'{digest}  {name}\n' for name, digest in checksums.items()), encoding='utf-8')
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for path in files + [manifest]:
        output.write(path, 'amm-dex/' + str(path.relative_to(root)))
with zipfile.ZipFile(archive) as check:
    assert check.testzip() is None
    for name, digest in checksums.items():
        assert hashlib.sha256(check.read('amm-dex/' + name)).hexdigest() == digest
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print(f'{archive}\n{len(files)+1} files; {archive.stat().st_size/1024/1024:.2f} MiB; CRC and all hashes passed')
