"""Six requested roots only; read-only bounded engine probes, not bulk media."""
import os,pathlib,subprocess,tempfile,tarfile,json,hashlib
base=pathlib.Path(tempfile.mkdtemp(prefix='gal-six-probe-'));root=base/'gal';root.mkdir()
names=['[circle] [RJ01687472] title','RJ01610188 extra','[RJ01660877]','RJ01474142','[publisher] Night Stroll v1.0','RJ01664771']
unchanged={}
for name in names+['RJ016874720','Night Stroll 2 Demo','meshiagirl']:
 g=root/name;g.mkdir();(g/'data').mkdir();(g/'data'/'System.json').write_text('{"gameTitle":"probe"}');(g/'game.exe').write_bytes(b'MZ'+bytes(1024*1024));(g/'readme.txt').write_text('engine');(g/'picture.png').write_bytes(b'must-not-collect-image');(g/'save').mkdir();(g/'save'/'save.dat').write_bytes(b'private save');unchanged[g/'game.exe']=hashlib.sha256((g/'game.exe').read_bytes()).hexdigest()
out=base/'out';env={k:v for k,v in os.environ.items() if not k.startswith('GAL_COLLECT_')};env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out));r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,text=True,capture_output=True);assert r.returncode==0,r.stdout+r.stderr
rows=(out/'games.tsv').read_text().splitlines()[1:];assert len(rows)==6,rows
for part in out.glob('*.part-*'):
 with tarfile.open(part,'r:gz') as a:
  ns=a.getnames();assert not any(n.endswith('picture.png') or '/save/' in n or n.endswith('/game.exe') for n in ns)
  report=json.load(a.extractfile(next(n for n in ns if n.endswith('__engine_probe/index.json'))));assert report['sampleBytes']<=8*1024*1024;assert report['sourceReadOnly'];assert any(n.endswith('/data/System.json') for n in ns)
for f,digest in unchanged.items():assert hashlib.sha256(f.read_bytes()).hexdigest()==digest
print('PASS six requested normalized roots, RJ prefix boundaries, decoys excluded, <=8MiB/game and source untouched:',base)
