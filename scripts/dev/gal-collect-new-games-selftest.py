import os, pathlib, subprocess, tempfile, tarfile, json
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-new-games-')); root=base/'gal';root.mkdir()
names=['シロクロv1.1','ツヴァイトリガー','AI','夜勤病棟リメイク','How to Build a Magnificent Kingdom v1.05','AI少女','Another Game']
for name in names:
    game=root/name; game.mkdir(); (game/'readme.txt').write_text('engine identification',encoding='utf-8')
    with (game/'game.exe').open('wb') as f:f.write(b'MZ');f.truncate(2*1024*1024)
    (game/'script.arc').write_bytes(b'archive-sample'*100)
    (game/'image.png').write_bytes(b'private-image')
    (game/'save').mkdir();(game/'save'/'secret.json').write_text('{"private":true}')
    (game/'data').mkdir();(game/'data'/'System.json').write_text('{"gameTitle":"test"}')
out=base/'out'
env={k:v for k,v in os.environ.items() if k not in ('GAL_COLLECT_TSK_LOG','GAL_COLLECT_RULES','GAL_COLLECT_ONLY')}
env.update(GAL_COLLECT_RULES='^new-games:probe$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
result=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,text=True,capture_output=True)
assert result.returncode==0,result.stdout+result.stderr
rows=(out/'games.tsv').read_text().splitlines()[1:];assert len(rows)==5,rows
assert not any('AI少女' in r or 'Another Game' in r for r in rows)
parts=sorted(out.glob('*.part-*'));assert len(parts)==5,parts
for part in parts:
    with tarfile.open(part,'r:gz') as tar:
        paths=tar.getnames();assert not any(p.endswith('game.exe') or p.endswith('image.png') or '/save/' in p for p in paths),paths
        index=json.load(tar.extractfile(next(p for p in paths if p.endswith('__engine_probe/index.json'))))
        assert index['sourceReadOnly'] and index['sampleBytes']<=8*1024*1024
        assert any(f['path']=='game.exe' and sum(p['bytes'] for p in f['parts'])<=256*1024 for f in index['files'])
        assert any(p.endswith('/data/System.json') for p in paths)
        assert len(tar.extractfile(next(p for p in paths if p.endswith('game.exe.head.bin'))).read())==128*1024
assert all((root/n/'game.exe').stat().st_size==2*1024*1024 for n in names)
print('PASS five exact targets, AI decoy excluded, bounded binary evidence, configs retained, source read-only; artifacts:',base)
