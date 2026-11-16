"""Exact five-game probe routing including the requested OrcX alias; source read-only."""
import os,pathlib,tempfile,subprocess,tarfile,json,hashlib,re,zlib,base64
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-four-rj-'));root=base/'gal';root.mkdir()
targets=['[circle] OrcX v1.0','RJ01562637 title','[RJ01375307] title','future','underworld']
decoys=['OrcX Other','RJ015626370','RJ013753070','future Other','underworld Other','dennou-djibril','Another Game']
for name in targets+decoys:
 game=root/name;(game/'data').mkdir(parents=True);(game/'data/System.json').write_text('{"gameTitle":"routing fixture"}');(game/'readme.txt').write_text('fixture');(game/'image.png').write_bytes(b'private image');(game/'save').mkdir();(game/'save/secret.json').write_text('private save')
before={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in root.rglob('*')if p.is_file()}
env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
script=base/'collect.sh';source=re.sub(r'^PAIR_ACTIVE_GAMES = .*$',"PAIR_ACTIVE_GAMES = ['RJ01743835','RJ01562637','RJ01375307','future','underworld']",pathlib.Path('scripts/dev/gal-collect-run.sh').read_text(),flags=re.M);script.write_text(re.sub("PAIR_MEDIA_PLAN='[^']+'","PAIR_MEDIA_PLAN='"+base64.b64encode(zlib.compress(b'{}')).decode()+"'",source))
r=subprocess.run(['bash',str(script),str(root)],env=env,text=True,capture_output=True);assert r.returncode==0,r.stdout+r.stderr
rows=(out/'games.tsv').read_text().splitlines()[1:];assert len(rows)==5,rows;assert set(row.split('\t')[1]for row in rows)==set(targets),rows
for part in out.glob('*.part-*'):
 with tarfile.open(part,'r:gz')as a:
  names=a.getnames();assert not any(n.endswith('image.png')or'/save/'in n for n in names);report=json.load(a.extractfile(next(n for n in names if n.endswith('__engine_probe/index.json'))));assert report['sourceReadOnly'];assert report['sampleBytes']<=8*1024*1024
assert before=={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in root.rglob('*')if p.is_file()}
print('PASS OrcX/RJ01743835 alias and four requested targets, decoys excluded, bounded evidence and unchanged source; retained:',base)
