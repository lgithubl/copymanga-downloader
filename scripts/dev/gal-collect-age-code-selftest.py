"""Default AGE collection copies one exact backup binary as data, never executes it."""
import pathlib, tempfile, re, json, zlib, base64, hashlib, subprocess, os, tarfile
src = pathlib.Path('scripts/dev/gal-collect-run.sh').read_text()
assert "ROUND_RULES='^new-games:age-code$'" in src
match = re.search(r"AGE_CODE_PLAN = '([^']+)'", src)
plan = json.loads(zlib.decompress(base64.b64decode(match[1])))
row = plan['天結いラビリンスマイスター']['ranges'][0]
assert len(plan['天結いラビリンスマイスター']['ranges']) == 1
assert row['source'] == 'AGE.EXE.org' and row['bytes'] == 4431616 and row['offset'] == 0
base = pathlib.Path(tempfile.mkdtemp(prefix='collect-age-code-'))
root = base/'gal'
game = root/'[メーカー] 天結いラビリンスマイスター'
game.mkdir(parents=True)
payload = b'MZ static-only-test, never executable'
original = game/'AGE.EXE.org'; original.write_bytes(payload)
(game/'AGE.EXE').write_bytes(b'previously collected packed engine')
(game/'DATA1.ALF').write_bytes(b'do not collect archives')
(game/'SYS4INI.BIN').write_bytes(b'index version guard')
other = root/'RJ328940'; other.mkdir(); (other/'Game.exe').write_bytes(b'other game ignored')
before = {p: p.read_bytes() for p in root.rglob('*') if p.is_file()}
fixture = {'天結いラビリンスマイスター': {'guards': [dict(source='SYS4INI.BIN', offset=0, bytes=19, sha256=hashlib.sha256(b'index version guard').hexdigest())], 'ranges': [dict(source='AGE.EXE.org', sourceBytes=len(payload), offset=0, bytes=len(payload), artifact='__verify/age/AGE.EXE.org')]}}
encoded = base64.b64encode(zlib.compress(json.dumps(fixture).encode())).decode()
script = base/'collector.sh'; script.write_text(src[:match.start(1)]+encoded+src[match.end(1):])
env = {k:v for k,v in os.environ.items() if not k.startswith('GAL_COLLECT_')}
out = base/'out'; env.update(GAL_COLLECT_DRYRUN='1', GAL_COLLECT_OUT=str(out))
run = subprocess.run(['bash', str(script), str(root)], env=env, capture_output=True, text=True)
assert run.returncode == 0, run.stdout+run.stderr
parts = list(out.glob('*.part-*')); assert len(parts) == 1
with tarfile.open(parts[0]) as archive:
    files = {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
    assert next(v for k,v in files.items() if k.endswith('__verify/age/AGE.EXE.org')) == payload
    report = json.loads(next(v for k,v in files.items() if k.endswith('__verify/index.json')))
    assert len(report['files']) == 1 and report['sampleBytes'] == len(payload)
    assert report['sourceReadOnly'] and 'Never execute' in report['notes'][0]
    assert not any(k.endswith('/AGE.EXE') or k.endswith('.ALF') or 'RJ328940' in k for k in files)
assert all(p.read_bytes() == data for p,data in before.items())
original.write_bytes(payload+b'changed')
env['GAL_COLLECT_OUT'] = str(base/'rejected')
run = subprocess.run(['bash', str(script), str(root)], env=env, capture_output=True, text=True)
assert run.returncode != 0 and 'source size changed' in run.stdout+run.stderr
print('PASS default AGE-only backup engine, exact version/size guards, no other sources or execution; retained:', base)
