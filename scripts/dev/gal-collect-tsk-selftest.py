"""Run the real collector offline on a tiny TSK library; archive fixture to /tmp."""
import csv
import hashlib
import io
import os
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
import time

script = Path(__file__).with_name('gal-collect-run.sh').resolve()
base = Path(tempfile.mkdtemp(prefix='gal-collect-tsk-test-'))
root = base / 'gal'
game = root / 'Twinkle Star Knights X'
assets = game / 'Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X'
now = time.time()

def put(path, data, age=0):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    os.utime(path, (now-age, now-age))

png = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 128, 64)
put(assets / 'Adventure/MainScenario/scene.book.json', b'{"importGridList":[]}')
put(assets / 'Adventure/Master.chapter.json', b'{"settingList":[]}')
for i in range(3):
    put(assets / ('Sprites/Recommend/recommend_%d.png' % i), png, i * 13 * 3600)
put(assets / 'Sprites/Chara/Thumb_005/L/chara_1001001.png', png)
put(assets / 'Sprites/Chara/Thumb_004/a/chara_1001001.png', png)
put(assets / 'Stills/st_1/st_1.png', png)
put(assets / 'Stills/st_1/st_1.atlas.txt', b'st_1.png\nsize: 128,64')
put(assets / 'Stills/st_1/st_1.skel.bytes', b'skeleton fixture')
put(assets / 'Sound/Bgm/BGM_B204_loop.ogg', b'fake audio, inventory only')
put(assets / 'Sound/BgVoice/b136_032_000071.ogg', b'fake audio, inventory only')
put(game / 'save000.dat', b'save must remain untouched')
put(root / 'Another Game/another.exe', b'unrelated')

def snapshot():
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}

before = snapshot()
out = base / 'out'
env = dict(os.environ, GAL_COLLECT_DRYRUN='1', GAL_COLLECT_OUT=str(out),
           GAL_COLLECT_RULES='^tsk:audit', GAL_COLLECT_TS='fixture', GH_TOKEN='')
result = subprocess.run(['bash', str(script), str(root)], env=env, text=True, errors='replace', capture_output=True)
assert result.returncode == 0, result.stdout + result.stderr
assert snapshot() == before, 'collector mutated library files'
parts = sorted(out.glob('*-g01.tar.gz.part-*'))
assert parts
with tarfile.open(fileobj=io.BytesIO(b''.join(p.read_bytes() for p in parts)), mode='r:gz') as archive:
    names = archive.getnames()
    def report(name):
        return list(csv.DictReader(io.StringIO(archive.extractfile('g01/' + name).read().decode()), delimiter='\t'))
    inventory = report('__tsk_inventory.tsv')
    recent = report('__tsk_recent12h.tsv')
    cards = [r for r in inventory if 'Thumb_005' in r['rel']]
    assert cards[0]['usage'] == 'gallery-card-keep'
    assert cards[0]['png_width'] == '128' and cards[0]['png_height'] == '64'
    assert any(r['category'] == 'bgm' for r in inventory)
    assert not any(n.endswith('.ogg') for n in names), 'audio payload collected'
    assert sum(n.endswith('.png') and '/Recommend/' in n for n in names) == 2
    assert not any('recommend_2.png' in n for n in names), 'oldest image selected'
    assert any(n.endswith('.book.json') for n in names)
    assert any(n.endswith('.atlas.txt') for n in names)
    assert any(n.endswith('.skel.bytes') for n in names)
    assert not any('save000' in n for n in names)
    assert not any('Another Game' in n for n in names)
    assert not any('recommend_1.png' in r['rel'] for r in recent)
print('PASS: TSK-only, read-only, recent-mtime inventory, PNG dimensions, bounded samples, spine companions, no audio payloads')
print('Fixture retained:', base)
