import pathlib,tempfile,os,subprocess,tarfile,json,struct
base=pathlib.Path(tempfile.mkdtemp(prefix='new-games-detail-'));root=base/'gal';root.mkdir()
names=['AI','How to Build a Magnificent Kingdom v1.05','シロクロv1.1','ツヴァイトリガー','夜勤病棟リメイク']
def put(game,rel,b):
 p=root/game/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
def chunk(tag,b):return tag+struct.pack('<Q',len(b))+b
for n in names:put(n,'not-requested.png',b'secret-image');put(n,'save/secret.dat',b'secret-save')
put(names[0],'pkg/aiduma-001(00).sx',b'SX-script');put(names[0],'pkg/aiduma-001-0.sxstorage',b'a'*700000);put(names[0],'aiduma.exe',b'MZ-test');put(names[0],'sakanagl.dll',b'local-analysis-only')
put(names[1],'data/strlist.txt',b'local-names')
for i in range(50):put(names[1],f'data/Script/{i:03}.txt',b'script')
for n in ['Game','Bgm','Se','Voice']:put(names[1],f'Pac/{n}.pac',b'pac'*300000)
put(names[2],'SHIROKURO_Data/il2cpp_data/Metadata/global-metadata.dat',b'metadata')
bundle=b'UnityFS\0'+struct.pack('>I',8)+b'5.x.x\0'+b'6000.0.23f1\0';bundle+=struct.pack('>Q',128)+bytes(128-len(bundle)-8)
for i in range(2):
 b=bytearray(b'@ARCH000\x0e20241122095209'+bundle+bytes(128)+b'index');idx=len(b)-5;b+=struct.pack('<Q',idx);put(names[2],f'Archives/base_div{i}_archive.arc',b)
name='l02.txt.scn';body=chunk(b'info',struct.pack('<IQQH',0x80000000,5,5,len(name))+name.encode('utf-16le'))+chunk(b'segm',struct.pack('<IQQQ',0,64,5,5));index=chunk(b'File',body)
xp3=bytearray(b'XP3\r\n \n\x1a\x8b\x67\x01'+struct.pack('<Q',96)+bytes(77));xp3[64:69]=b'abcde';xp3+=b'\0'+struct.pack('<Q',len(index))+index
for n in ['data','patch','bgimage','evimage','fgimage','voice']:put(names[3],n+'.xp3',xp3)
put(names[3],'original/ツヴァイトリガー.exe',b'MZ-original');put(names[3],'plugin/KAGParserEx.dll',b'dll');put(names[3],'plugin/psbfile.dll',b'dll')
put(names[4],'script.arc',b'SCRE-script');put(names[4],'data.arc',b'table');put(names[4],'systeminfo.json',b'{}')
for n in ['image','voice','music','effect']:put(names[4],n+'.arc',struct.pack('<I',16)+bytes(16)+b'not-copied-resource')
put('AI少女','game.exe',b'not requested')
env={k:v for k,v in os.environ.items() if k not in ['GAL_COLLECT_TSK_LOG','GAL_COLLECT_RULES','GAL_COLLECT_ONLY']};out=base/'out';env.update(GAL_COLLECT_DRYRUN='1',GAL_COLLECT_OUT=str(out))
r=subprocess.run(['bash','scripts/dev/gal-collect-run.sh',str(root)],env=env,capture_output=True,text=True);assert r.returncode==0,r.stdout+r.stderr
parts=sorted(out.glob('*.part-*'));assert len(parts)==5
allnames=[];artifacts={}
for part in parts:
 with tarfile.open(part) as t:
  paths=t.getnames();allnames+=paths
  report=json.load(t.extractfile(next(p for p in paths if p.endswith('__followup/index.json'))));assert report['sourceReadOnly'] and report['sampleBytes']<=16*1024*1024
  artifacts[report['game']]={p.split('/',1)[1]:t.extractfile(p).read() for p in paths if t.getmember(p).isfile()}
assert artifacts[names[0]]['pkg/aiduma-001(00).sx']==b'SX-script'
assert 'data/strlist.txt' in artifacts[names[1]]
assert artifacts[names[2]]['__followup/unity/base_div0_archive.arc.first.bundle']==bundle
assert artifacts[names[3]]['__followup/xp3/patch.xp3/entries/000000-0.bin']==b'abcde'
entries=json.loads(artifacts[names[3]]['__followup/xp3/patch.xp3/entries.json'])['entries'];assert entries[0]['flags']==0x80000000
assert artifacts[names[4]]['script.arc']==b'SCRE-script';assert 'image.arc' not in artifacts[names[4]]
assert not any('/save/' in n or 'not-requested.png' in n for n in allnames)
print('PASS focused five-game followup: SX, sampled text/PAC, Unity first bundle/index, XP3 protected raw samples/index, script/data + resource tables; no whole resource archives or saves; retained:',base)
