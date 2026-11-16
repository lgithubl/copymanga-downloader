"""The real collector must read a bounded >4MiB native manifest in full before projecting it."""
from pathlib import Path
import tempfile,json,hashlib,base64,zlib,re,subprocess,os,tarfile
base=Path(tempfile.mkdtemp(prefix='gal-native-runtime-'));root=base/'gal';game=root/'future';(game/'futrue_Data/arc').mkdir(parents=True);anchor=game/'futrue_Data/globalgamemanagers';anchor.write_bytes(b'data')
native=game/'futrue_Data/arc/native.json';native.write_text(json.dumps({'format':'catpaw-context/1','locales':[{'terms':['x'*(5*1024*1024)]}],'configs':{'recallConfig':{'100000':{'role':'native'}}},'models':{},'scenes':[]}));digest=hashlib.sha256(native.read_bytes()).hexdigest();under=root/'underworld';under.mkdir();(under/'game.ini').write_text('[game]\nengine=probe\n')
plan={'future':[{'path':'futrue_Data/globalgamemanagers','sourceBytes':4,'offset':0,'bytes':4,'name':'__probe/anchor.bin'}]};src=Path('scripts/dev/gal-collect-run.sh').read_text();src=re.sub(r"PAIR_ACTIVE_GAMES = .*", "PAIR_ACTIVE_GAMES = ['future','underworld']",src);src=re.sub(r"PAIR_MEDIA_PLAN='[^']*'", "PAIR_MEDIA_PLAN='"+base64.b64encode(zlib.compress(json.dumps(plan).encode())).decode()+"'",src);script=base/'collector.sh';script.write_text(src);env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_RULES='^new-games:fuyu-edo$',GAL_COLLECT_OUT=str(base/'output'));result=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert result.returncode==0,result.stdout+result.stderr
seen=0
for p in(base/'output').glob('*.part-*'):
 with tarfile.open(p)as t:
  for n in t.getnames():
   if n.endswith('/__pair_runtime/files/futrue_Data/arc/native.json'):
    d=json.load(t.extractfile(n));assert d['configs']['recallConfig']['100000']['role']=='native';assert d['__collectionProjection']['sourceSha256']==digest;assert d['__collectionProjection']['originalBytes']==native.stat().st_size;assert'locales'not in d;seen+=1
assert seen==1;assert hashlib.sha256(native.read_bytes()).hexdigest()==digest
print('PASS actual collector: full bounded 5MiB manifest read, explicit projection/source SHA, configs retained, underworld probe and source unchanged; retained:',base)
