// Verify captures against the collection SHA256 and copy exact original files.
import{readFile,mkdir,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
import path from'node:path'
export async function makeMeshiFixture(target='.cache/meshiagirl/fixture'){
 for(const round of ['detail','media','cg']){const base=path.resolve('.cache/meshiagirl',round,'extracted/g01');let report;try{report=JSON.parse(await readFile(base+'/__pair_media/index.json'))}catch(e){if(e.code==='ENOENT')continue;throw e}for(const f of report.files){const b=await readFile(path.join(base,f.name));if(f.offset!==0||b.length!==f.sourceBytes||createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('Capture mismatch '+f.path);const dest=path.join(target,f.path);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,b)}}return path.resolve(target)
}
if(process.argv[1]?.endsWith('make-meshiagirl-fixture.mjs'))console.log(await makeMeshiFixture())
