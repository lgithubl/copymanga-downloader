"""Next-round target routing, bounded evidence and source read-only guarantees."""
import os,pathlib,tempfile,subprocess,tarfile,json,hashlib
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-next-games-'));root=base/'gal';root.mkdir()
targets=['[メーカー] 天結いラビリンスマイスター','Remastered','[RJ01646655] title','RJ328940 title','[circle] [RJ01271506] title']
decoys=['AI','ツヴァイトリガー','シロクロv1.1','Remastered Other','RJ016466550 title','RJ3289400 title','RJ012715060 title','Another Game']
for name in targets+decoys:
 game=root/name;game.mkdir();(game/'readme.txt').write_text('engine identification',encoding='utf-8');(game/'data').mkdir();(game/'data'/'System.json').write_text('{"gameTitle":"fixture"}')
 with (game/'game.exe').open('wb') as f:f.write(b'MZ');f.truncate(2*1024*1024)
 (game/'Game.rgss3a').write_bytes(b'RGSSAD\0\3'+b'x'*200000)
 (game/'image.png').write_bytes(b'private image');(game/'save').mkdir();(game/'save'/'secret.json').write_text('{"private":true}')
snapshot={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
env={k:v for k,v in os.environ.items() if k not in ('GAL_COLLECT_TSK_LOG','GAL_COLLECT_RULES','GAL_COLLECT_ONLY','GAL_COLLECT_RULES_DEFAULT')};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out),GAL_COLLECT_RULES='^new-games:next$')
r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,text=True,capture_output=True);assert r.returncode==0,r.stdout+r.stderr
rows=(out/'games.tsv').read_text().splitlines()[1:];assert len(rows)==5,rows
assert set(row.split('\t')[1] for row in rows)==set(targets),rows
parts=sorted(out.glob('*.part-*'));assert len(parts)==5,parts
for part in parts:
 with tarfile.open(part,'r:gz') as tar:
  paths=tar.getnames();assert not any(p.endswith('game.exe') or p.endswith('image.png') or '/save/' in p for p in paths),paths
  report=json.load(tar.extractfile(next(p for p in paths if p.endswith('__engine_probe/index.json'))));assert report['sourceReadOnly'] and report['sampleBytes']<=8*1024*1024
  assert any(x['path']=='Game.rgss3a' for x in report['files']);assert any(p.endswith('/data/System.json') for p in paths)
  e=next(x for x in report['files'] if x['path']=='game.exe');assert sum(x['bytes'] for x in e['parts'])==256*1024
assert snapshot=={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
print('PASS default next round: five requested targets, bracket/version decoys excluded, bounded RGSS/EXE evidence, configs, no image/save content, source unchanged; retained:',base)
