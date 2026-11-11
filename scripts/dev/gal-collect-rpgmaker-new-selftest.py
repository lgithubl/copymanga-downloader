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
env = dict(os.environ, GAL_COLLECT_DRYRUN='1', GAL_COLLECT_OUT=str(out), GAL_COLLECT_TS='fixture', GH_TOKEN='')
for key in ['GAL_COLLECT_TSK_LOG', 'GAL_COLLECT_RULES', 'GAL_COLLECT_ONLY']:
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
