"""Only the missing prologue CGs; original source stays read-only."""
import base64, hashlib, json, os, pathlib, re, subprocess, tarfile, tempfile, zlib

src = pathlib.Path('scripts/dev/gal-collect-run.sh').read_text()
assert "ROUND_RULES='^new-games:age-display$'" in src
match = re.search(r"AGE_SCENE_PLAN = '([^']+)'", src)
plan = json.loads(zlib.decompress(base64.b64decode(match[1])))
rows = plan['天結いラビリンスマイスター']['ranges']
assert [(r['logicalName'], r['bytes']) for r in rows] == [('EV901A.AGF', 8851397), ('EV902A.AGF', 3960190)]
assert sum(r['bytes'] for r in rows) < 13 * 1024 * 1024
assert all(r['source'] == 'DATA2.ALF' and r['offset'] + r['bytes'] <= r['sourceBytes'] for r in rows)
base = pathlib.Path(tempfile.mkdtemp(prefix='collect-age-scene-'))
root = base/'gal'; game = root/'天結いラビリンスマイスター'; game.mkdir(parents=True)
(root/'OtherGame').mkdir(); (root/'OtherGame/AGE.EXE').write_bytes(b'ignore')
(game/'AGE.EXE').write_bytes(b'never execute or collect')
(game/'SYS4INI.BIN').write_bytes(b'version')
payload = b'CG' * (4500 * 1024)  # > 8MiB, original CG must not be silently truncated
source = game/'DATA2.ALF'; source.write_bytes(b'HEAD' + payload + b'TAIL')
before = hashlib.sha256(source.read_bytes()).hexdigest()
fixture = {'天結いラビリンスマイスター': {'guards': [dict(source='SYS4INI.BIN', offset=0, bytes=7, sha256=hashlib.sha256(b'version').hexdigest())], 'ranges': [dict(source='DATA2.ALF', sourceBytes=source.stat().st_size, offset=4, bytes=len(payload), artifact='__verify/age/EV901A.AGF')]}}
encoded = base64.b64encode(zlib.compress(json.dumps(fixture).encode())).decode()
script = base/'collector.sh'; script.write_text(src[:match.start(1)] + encoded + src[match.end(1):])
env = {k:v for k,v in os.environ.items() if not k.startswith('GAL_COLLECT_')}
out = base/'out'; env.update(GAL_COLLECT_RULES='^new-games:age-scene$', GAL_COLLECT_DRYRUN='1', GAL_COLLECT_OUT=str(out))
run = subprocess.run(['bash', str(script), str(root)], env=env, text=True, capture_output=True)
assert run.returncode == 0, run.stdout + run.stderr
parts = list(out.glob('*.part-*')); assert len(parts) == 1
with tarfile.open(parts[0]) as archive:
    names = archive.getnames()
    assert not any(n.endswith('.EXE') or n.endswith('.ALF') or 'OtherGame' in n for n in names)
    assert archive.extractfile(next(n for n in names if n.endswith('EV901A.AGF'))).read() == payload
    report = json.load(archive.extractfile(next(n for n in names if n.endswith('__verify/index.json'))))
    assert report['sampleBytes'] == len(payload) and report['sourceReadOnly']
assert hashlib.sha256(source.read_bytes()).hexdigest() == before
(game/'SYS4INI.BIN').write_bytes(b'changed')
env['GAL_COLLECT_OUT'] = str(base/'rejected')
run = subprocess.run(['bash', str(script), str(root)], env=env, text=True, capture_output=True)
assert run.returncode != 0 and 'refusing stale offsets' in run.stdout + run.stderr
print('PASS two exact prologue CGs, complete >8MiB image, hash guard, no runtime/other games, source unchanged; retained:', base)
