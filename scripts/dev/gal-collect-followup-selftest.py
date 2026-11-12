"""Collector1.59 selects four exact sources and leaves originals unchanged."""
import pathlib,tempfile,re,json,zlib,base64,hashlib,struct,subprocess,os,tarfile
src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text();base=pathlib.Path(tempfile.mkdtemp(prefix='collect-followup-'));root=base/'gal';root.mkdir();before={}
def put(game,rel,b):
 p=root/game/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);before[p]=b
pac='How to Build a Magnificent Kingdom v1.05';put(pac,'data/Script/30_8021.txt',b'#BGSET,70,0\n#CG,5,2,0\n#END\n')
table=bytearray(544)
for i,n in enumerate([b'data/Graphics/BG/0070.png',b'data/Graphics/CG/005_02.png']):table[i*272:i*272+len(n)]=n;struct.pack_into('<QII',table,i*272+256,i*4,4,len(n))
put(pac,'Pac/Game.pac',b'\x82\xcf\x82\xad'+struct.pack('<IQ',2,560)+table+b'BG!!CG!!')
for i in [16,62,72,82,116]:put('RJ01271506','data/Map%03d.json'%i,b'{"events":[]}')
for rel in ['normal.png_','texture.png_','texture.json']:put('RJ01271506','img/pictures/busts/bisty/'+rel,b'sample')
for i in [0,1]:put('RJ328940','www/img/parallaxes/_Lize_SceneA_%02d.rpgmvp'%i,b'encrypted sample')
put('Remastered','source.arc',b'HEADpayload');put('AI','source.bin',b'unrelated');put('天結いラビリンスマイスター','AGE.EXE',b'unrelated')
plan={'Remastered':{'guards':[dict(source='source.arc',offset=0,bytes=4,sha256=hashlib.sha256(b'HEAD').hexdigest())],'ranges':[dict(source='source.arc',sourceBytes=11,offset=4,bytes=7,artifact='__bugs/remastered/sample.bin')]}}
match=re.search(r"FOLLOWUP_PLAN = '([^']+)'",src);packed=base64.b64encode(zlib.compress(json.dumps(plan).encode())).decode();script=base/'collector.sh';script.write_text(src[:match.start(1)]+packed+src[match.end(1):]);env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_RULES='^new-games:followup$',GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out));r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==4,(len(parts),r.stdout,r.stderr);reports={}
for part in parts:
 with tarfile.open(part)as t:
  names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__bugs/index.json'))));reports[report['game']]=report;assert report['sourceReadOnly']
  for row in report['files']:
   b=t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))).read();assert len(b)==row['bytes']and hashlib.sha256(b).hexdigest()==row['sha256']
assert len(reports[pac]['files'])==3;assert len(reports['RJ01271506']['files'])==8;assert len(reports['RJ328940']['files'])==2;assert all(p.read_bytes()==b for p,b in before.items())
print('PASS followup four-games routing, PAC scene BG/CG references, actual RPG actor/parallax paths, Remastered guarded ranges, source unchanged; retained:',base)
