"""Exercise default new-RJ discovery and bounded metadata/source collection."""
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

base = Path(tempfile.mkdtemp(prefix='gal-collect-new-rj-'))
root, out = base / 'gal', base / 'out'

def put(rel, content):
    file = root / rel
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)

for game, sub, engine in [('RJ01500001 game', 'www/', 'rpg_core'), ('RJ01500002 game', '', 'rmmz_core'), ('[RJ01500003] game', 'game/www/', 'rpg_core')]:
    prefix = game + '/' + sub
    put(prefix + 'data/System.json', '{"gameTitle":"fixture"}')
    put(prefix + 'data/CommonEvents.json', '[null]')
    put(prefix + 'data/Map001.json', '{"events":[]}')
    put(prefix + 'js/' + engine + '.js', '/* engine source only */')
    put(prefix + 'js/plugins.js', 'var $plugins=[];')
    put(prefix + 'js/plugins/MyPlugin.js', '/* plugin source only */')
    put(prefix + 'js/libs/runtime.js', 'runtime must not be collected')
    put(prefix + 'img/pictures/CG.png', 'image must not be collected')
    put(prefix + 'audio/voice/a.ogg', 'audio must not be collected')
    put(prefix + 'save/file1.rpgsave', 'save must not be collected')
    put(game + '/Game.exe', 'executable must not be collected')
    put(game + '/package.json', '{"name":"game"}')
put('RJ01482469 old/www/data/System.json', '{}')
put('Unrelated Game/www/data/System.json', '{}')
put('gal-download/runs/tsk/result.json', '{}')
# Sparse file proves large game data is listed, explicitly omitted, not packed.
big = root / 'RJ01500001 game/www/data/Huge.json'
with big.open('wb') as f:
    f.truncate(17 * 1024 * 1024)
before = {str(p): (p.stat().st_size, p.stat().st_mtime_ns) for p in root.rglob('*') if p.is_file()}
env = dict(os.environ, GAL_COLLECT_DRYRUN='1', GAL_COLLECT_OUT=str(out), GAL_COLLECT_TS='fixture', GAL_COLLECT_RULES='^rpgmaker:new-rj$', GH_TOKEN='')
for key in ['GAL_COLLECT_TSK_LOG', 'GAL_COLLECT_ONLY']:
    env.pop(key, None)
run = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)], env=env, capture_output=True, text=True)
assert run.returncode == 0, run.stdout + run.stderr
assert '游戏根 3 个' in run.stdout + run.stderr, run.stdout + run.stderr
assert '超过采集上限' in run.stdout + run.stderr
assert before == {str(p): (p.stat().st_size, p.stat().st_mtime_ns) for p in root.rglob('*') if p.is_file()}
groups = sorted(out.glob('*-g*.tar.gz.part-000'))
assert len(groups) == 3, groups
for part in groups:
    with tarfile.open(fileobj=io.BytesIO(part.read_bytes()), mode='r:gz') as archive:
        names = archive.getnames()
        assert any(n.endswith('data/CommonEvents.json') for n in names)
        assert any(n.endswith('js/plugins/MyPlugin.js') for n in names)
        assert not any('/save/' in n or '/js/libs/' in n or n.endswith(('.exe', '.png', '.ogg', 'Huge.json')) for n in names), names
        audit = json.load(archive.extractfile(next(n for n in names if n.endswith('__rpgmaker_audit.json'))))
        assert audit['systemFiles'] and audit['selectedFiles'] >= 7
        if audit['omitted']:
            assert audit['omitted'][0]['path'].endswith('Huge.json')
assert sum(p.stat().st_size for p in groups) < 100000
print('PASS: three new RJ games, MV/MZ and nested roots, old/unrelated games excluded, source read-only, no media/runtime/save payloads, explicit size omissions')
print('Fixture retained:', base)

packed = root / 'RJ01220265'
packed.mkdir()
(packed / '■readme.txt').write_text('fixture readme')
exe = packed / 'HypnosisNTR.exe'
with exe.open('wb') as f:
    f.write(b'MZ'); f.seek(1800000000-4); f.write(b'GDPC')
probe_out = base / 'probe-out'
probe_env = dict(env, GAL_COLLECT_RULES='^rpgmaker:packed-probe$', GAL_COLLECT_OUT=str(probe_out))
probe = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)], env=probe_env, capture_output=True, text=True)
assert probe.returncode == 0, probe.stdout + probe.stderr
parts = sorted(probe_out.glob('*-g*.tar.gz.part-000'))
assert len(parts) == 1
with tarfile.open(fileobj=io.BytesIO(parts[0].read_bytes()), mode='r:gz') as archive:
    assert not any(n.endswith('.exe') for n in archive.getnames())
    index = json.load(archive.extractfile('g01/__exe_probe/index.json'))
    assert index['probes'][0]['sourceBytes'] == 1800000000
    assert index['probes'][0]['headBytes'] == index['probes'][0]['tailBytes'] == 256*1024
    assert archive.extractfile('g01/__exe_probe/HypnosisNTR.exe.tail.bin').read().endswith(b'GDPC')
    assert 'g01/■readme.txt' in archive.getnames()
assert exe.stat().st_size == 1800000000
print('PASS: packed-RJ probe selects one game, reads only 512KB of 1.8GB EXE, includes readme, source unchanged')

# A native-layout EVB table exercises seek-based collection, not just PE heads.
import struct
contents = []
def vfs_node(name, children=None, data=None, original=None):
    kind = 3 if children is not None else 2
    header = struct.pack('<I8sI', 256, b'\0'*8, len(children or []))
    named = name.encode('utf-16-le') + b'\0\0' + bytes([kind])
    if kind == 3:
        return header + named + b'\0'*25 + b''.join(children)
    original = len(data) if original is None else original
    contents.append(data)
    optional = b'\0'*2 + struct.pack('<I', original) + b'\0'*43 + struct.pack('<I', len(data))
    assert len(optional) == 53
    return header + named + optional
stream = vfs_node('www', children=[
    vfs_node('data', children=[vfs_node('System.json', data=b'{"gameTitle":"Packed fixture"}'), vfs_node('CommonEvents.json', data=b'[null]')]),
    vfs_node('js', children=[vfs_node('plugins.js', data=b'var $plugins=[];'), vfs_node('plugins', children=[vfs_node('MyPlugin.js', data=b'cmp', original=123)]), vfs_node('libs', children=[vfs_node('runtime.js', data=b'runtime excluded')])]),
    vfs_node('img', children=[vfs_node('CG.png', data=b'media excluded')]),
    vfs_node('save', children=[vfs_node('file1.rpgsave', data=b'save excluded')]),
])
assert stream[0] == 0
length = 79 + len(stream)
table = b'EVB\0' + b'\0'*60 + struct.pack('<I8sI', length-68, b'\0'*8, 1) + stream[1:]
assert len(table) == length
resource = table + b''.join(contents)
section_offset = 4096
loader_offset = ((section_offset + len(resource) + 511)//512)*512
image = bytearray(loader_offset+256)
image[:2] = b'MZ'; struct.pack_into('<I', image, 60, 128)
image[128:132] = b'PE\0\0'; struct.pack_into('<H', image, 134, 2); struct.pack_into('<H', image, 148, 224)
for index, (name, offset, size) in enumerate([(b'.enigma1', section_offset, len(resource)), (b'.enigma2', loader_offset, 256)]):
    at = 128+24+224+index*40
    image[at:at+8] = name
    struct.pack_into('<IIII', image, at+8, size, offset, size, offset)
image[section_offset:section_offset+len(resource)] = resource
exe.write_bytes(image)
before_probe = (exe.stat().st_size, exe.stat().st_mtime_ns, exe.read_bytes())
vfs_out = base / 'vfs-out'
probe = subprocess.run(['bash', 'scripts/dev/gal-collect-run.sh', str(root)], env=dict(probe_env, GAL_COLLECT_OUT=str(vfs_out)), capture_output=True, text=True)
assert probe.returncode == 0, probe.stdout + probe.stderr
part = next(vfs_out.glob('*-g01.tar.gz.part-000'))
with tarfile.open(fileobj=io.BytesIO(part.read_bytes()), mode='r:gz') as archive:
    prefix = 'g01/__exe_probe/HypnosisNTR.exe/'
    index = json.load(archive.extractfile(prefix + 'vfs-index.json'))
    assert index['status'] == 'indexed', index
    assert len(index['files']) == 7 and len(index['selected']) == 4, index
    assert not any('/libs/' in row['path'] or '/img/' in row['path'] or '/save/' in row['path'] for row in index['selected'])
    row = next(row for row in index['selected'] if row['path'].endswith('/System.json'))
    assert json.load(archive.extractfile(prefix + row['payload']))['gameTitle'] == 'Packed fixture'
    row = next(row for row in index['selected'] if row['path'].endswith('/MyPlugin.js'))
    assert row['compressed'] and row['originalBytes'] == 123
    assert archive.extractfile(prefix + row['payload']).read() == b'cmp'
assert before_probe == (exe.stat().st_size, exe.stat().st_mtime_ns, exe.read_bytes())
print('PASS: EVB file table, resource offsets, selected JSON/plugin stored blocks, compressed blocks preserved, media/save/runtime excluded, EXE read-only')
