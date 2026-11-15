"""Explicit ddd capture includes whole files/hidden/dependencies, never other roots."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

cache = Path('.cache/ddd-collection-test').resolve()
cache.mkdir(parents=True, exist_ok=True)
base = Path(tempfile.mkdtemp(prefix='run-', dir=cache))
root = base / 'gal'
game = root / '[tools]' / 'ddd'
game.mkdir(parents=True)
payloads = {
    'README.md': b'fixture downloader source',
    '.git/config': b'[core]\n bare = false\n',
    'node_modules/a/index.js': b'export default 1',
    'cache/list.json': b'{"cdn":[]}',
    'save/entry.dat': b'keep explicitly requested whole directory',
    'empty.bin': b'',
    'media/picture.png': os.urandom(2400000),
}
before = {}
for name, data in payloads.items():
    file = game / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data)
    before[name] = (file.stat().st_mtime_ns, hashlib.sha256(data).hexdigest())
(game / 'empty-directory').mkdir()
(game / 'readme-link').symlink_to('README.md')
(game / 'external-link').symlink_to(base / 'external-secret')
(base / 'external-secret').write_bytes(b'must not follow links outside target')
decoy = root / 'ddd-extra'
decoy.mkdir()
(decoy / 'unrelated.exe').write_bytes(b'must not collect')
env = {k: v for k, v in os.environ.items() if not k.startswith('GAL_COLLECT_')}
env.update(GAL_COLLECT_DRYRUN='1', GAL_COLLECT_RULES='^directory:ddd$',
           GAL_COLLECT_OUT=str(base / 'out'), GAL_COLLECT_PART_MB='1',
           GAL_COLLECT_FULL_MAX_MB='0.001', GH_TOKEN='')
run = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)],
                     env=env, text=True, capture_output=True, timeout=60)
assert run.returncode == 0, run.stdout + run.stderr
parts = sorted((base / 'out').glob('*-g01.tar.gz.part-*'))
assert len(parts) >= 3, parts
with tarfile.open(fileobj=io.BytesIO(b''.join(p.read_bytes() for p in parts))) as archive:
    names = archive.getnames()
    report = json.load(archive.extractfile('g01/__directory-index.json'))
    assert report['complete'] and report['sourceReadOnly']
    assert report['regularFileBytes'] == sum(map(len, payloads.values()))
    rows = {r['path']: r for r in report['entries']}
    for name, data in payloads.items():
        assert archive.extractfile('g01/files/' + name).read() == data
        assert rows[name]['sha256'] == hashlib.sha256(data).hexdigest()
        file = game / name
        assert (file.stat().st_mtime_ns, hashlib.sha256(file.read_bytes()).hexdigest()) == before[name]
    assert archive.getmember('g01/files/empty-directory').isdir()
    assert archive.getmember('g01/files/readme-link').issym()
    assert archive.getmember('g01/files/external-link').issym()
    assert not any('ddd-extra' in name or 'external-secret' in name for name in names)
assert len((base / 'out/games.tsv').read_text().splitlines()) == 2
assert json.loads((base / 'out/info.json').read_text())['complete']

limited = dict(env, GAL_COLLECT_TOTAL_MAX_MB='1', GAL_COLLECT_OUT=str(base / 'limited'))
failed = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)],
                        env=limited, text=True, capture_output=True, timeout=60)
assert failed.returncode != 0 and '没有截断' in failed.stdout + failed.stderr
assert not list((base / 'limited').glob('*-g01.tar.gz.part-*'))
print('PASS complete ddd directory, split archive, hashes, hidden/media/cache/dependencies, links, source unchanged, oversize fails before packing:', base)
