"""Reported-scene collector uses native PAC offsets, strict guards and read-only inputs."""
import pathlib,tempfile,re,json,zlib,base64,hashlib,struct,subprocess,os,tarfile
src=pathlib.Path('scripts/dev/gal-collect-run.sh').read_text()
base=pathlib.Path(tempfile.mkdtemp(prefix='collect-bug-cases-'));root=base/'gal';root.mkdir();before={}
def put(name,rel,data):
 p=root/name/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);before[p]=data;return p
pac='How to Build a Magnificent Kingdom v1.05'
put(pac,'data/Script/00_1250.txt',b'#BGSET,70,0\n#MSG\nA\nscene\n#END\n')
name=b'data/Graphics/BG/0070.png';table=bytearray(272);table[:len(name)]=name;struct.pack_into('<QII',table,256,0,8,len(name))
put(pac,'Pac/Game.pac',b'\x82\xcf\x82\xad'+struct.pack('<IQ',1,288)+table+b'PNGbytes')
put('RJ328940','www/data/Map081.json',b'{"events":[]}')
p=put('シロクロv1.1','Archives/sample.arc',b'HEADpayload')
put('AI','source.bin',b'unrelated');put('天結いラビリンスマイスター','AGE.EXE',b'do not collect')
fixture={'シロクロv1.1':{'guards':[dict(source='Archives/sample.arc',offset=0,bytes=4,sha256=hashlib.sha256(b'HEAD').hexdigest())],'ranges':[dict(source='Archives/sample.arc',sourceBytes=11,offset=4,bytes=7,artifact='__bugs/shiro/image.bin')]}}
match=re.search(r"BUG_CASE_PLAN = '([^']+)'",src);packed=base64.b64encode(zlib.compress(json.dumps(fixture).encode())).decode();script=base/'collector.sh';script.write_text(src[:match.start(1)]+packed+src[match.end(1):])
env={k:v for k,v in os.environ.items()if not k.startswith('GAL_COLLECT_')};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==3,r.stdout+r.stderr
reports={}
for part in parts:
 with tarfile.open(part)as t:
  names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__bugs/index.json'))));reports[report['game']]=report
  assert report['sourceReadOnly'];assert not any(n.endswith(('.EXE','.exe','.dll'))for n in names)
  for row in report['files']:
   data=t.extractfile(next(n for n in names if n.endswith('/'+row['artifact']))).read();assert len(data)==row['bytes']and hashlib.sha256(data).hexdigest()==row['sha256']
assert reports[pac]['notes'][0]['backgroundsNotInArchive']==[]
assert reports[pac]['files'][1]['offset']==288
assert all(p.read_bytes()==b for p,b in before.items())
p.write_bytes(b'FAILpayload');env['GAL_COLLECT_OUT']=str(base/'rejected');r=subprocess.run(['bash',str(script),str(root)],env=env,capture_output=True,text=True);assert r.returncode!=0 and 'refusing stale offsets' in r.stdout+r.stderr
print('PASS three requested games only; PAC scene background references; Shiro exact version-guarded ranges; target Map081; source unchanged; retained:',base)
