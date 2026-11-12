"""Explicit template round reads only the eight plugin-declared native template maps."""
import pathlib,tempfile,subprocess,os,tarfile,json,hashlib
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-mz-template-'));root=base/'gal';out=base/'out';game=root/'RJ01271506';(game/'data').mkdir(parents=True)
ids=[93,94,95,96,97,98,251,252];before={}
for id in ids:
 p=game/'data'/('Map%03d.json'%id);p.write_text(json.dumps({'events':[],'nativeTemplate':id}));before[p]=p.read_bytes()
for name in ['Remastered','RJ328940','How to Build a Magnificent Kingdom v1.05']:
 p=root/name/'source.bin';p.parent.mkdir();p.write_bytes(b'not requested');before[p]=p.read_bytes()
env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};env.update(GAL_COLLECT_RULES='^new-games:mz-templates$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==1,(parts,r.stdout)
with tarfile.open(parts[0])as t:
 names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__bugs/index.json'))));assert report['game']=='RJ01271506'and report['sourceReadOnly'];assert len(report['files'])==8
 for row in report['files']:
  b=t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))).read();assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256']
assert all(p.read_bytes()==b for p,b in before.items())
print('PASS eight declared template maps only, one game, SHA/size checks, sources unchanged; retained:',base)
