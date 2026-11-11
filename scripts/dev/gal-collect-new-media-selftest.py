import pathlib,tempfile,os,subprocess,tarfile,json,struct
base=pathlib.Path(tempfile.mkdtemp(prefix='new-media-'));root=base/'gal';root.mkdir()
def put(game,rel,b):
 p=root/game/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
def pac(rows):
 start=16+272*len(rows);head=bytearray(bytes.fromhex('82cf82ad')+struct.pack('<IQ',len(rows),start));off=0;parts=[]
 for name,data in rows:
  n=name.encode();head+=n+bytes(256-len(n))+struct.pack('<QII',off,len(data),len(n));parts.append(data);off+=len(data)
 return head+b''.join(parts)
def arc(rows):
 start=4+sum(1+len(n)+12 for n,b in rows);table=bytearray(struct.pack('<I',start-4));parts=[];off=start
 for n,b in rows:
  raw=bytes((ord(c)-len(n)+i)&255 for i,c in enumerate(n));table+=bytes([len(n)])+raw+struct.pack('>III',len(b),len(b),off);parts.append(b);off+=len(b)
 return table+b''.join(parts)
night='夜勤病棟リメイク';king='How to Build a Magnificent Kingdom v1.05'
put(night,'image.arc',arc([('OP001.PNG',b'background'),('A001_01.PNG',b'cg'),('FG_REN04A01L.CHAR',b'{}'),('UNRELATED.PNG',b'unrelated')]))
put(night,'voice.arc',arc([('VOICE/00_PROLOGUE_001.OGG',b'voice')]))
for archive,rows in [('Game',[('data/Graphics/BG/0070.png',b'bg'),('data/Graphics/BU/000_00.png',b'bu'),('data/Graphics/CG/023_50.png',b'cg'),('data/Graphics/CG/023_51.png',b'cg2'),('data/Graphics/CG/023_52.png',b'unrequested')]),('Bgm',[('data/Sound/BGM/401.ogg',b'bgm')]),('Se',[('data/Sound/SE/000.wav',b'se')]),('Voice',[('data/Sound/voice/Nyan01_0070_00.ogg',b'voice')])]:put(king,'Pac/'+archive+'.pac',pac(rows))
for game in [night,king,'AI','シロクロv1.1','ツヴァイトリガー']:
 put(game,'saves/secret.dat',b'save');put(game,'unrequested.exe',b'EXE')
env={k:v for k,v in os.environ.items() if k not in ['GAL_COLLECT_RULES','GAL_COLLECT_TSK_LOG','GAL_COLLECT_ONLY']};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=list(out.glob('*.part-*'));assert len(parts)==2
found={}
for part in parts:
 with tarfile.open(part) as t:
  names=t.getnames();report=json.load(t.extractfile(next(n for n in names if n.endswith('__media/index.json'))));assert report['sourceReadOnly'];found[report['game']]=report
  assert not any('/saves/' in n or n.endswith('.exe') or n.endswith('UNRELATED.PNG') or n.endswith('023_52.png') for n in names)
assert set(found)=={night,king}
assert any(x['artifact'].endswith('Voice.pac.table.bin') for x in found[king]['files'])
assert any(x['artifact'].endswith('00_PROLOGUE_001.OGG') for x in found[night]['files'])
assert len([x for x in found[king]['files'] if '/CG/' in x['artifact']])==2
print('PASS bounded two-game real media collection: complete PAC tables, two CGs, known BG/BU/voice; source read-only; no full packs/executables/saves; retained:',base)
