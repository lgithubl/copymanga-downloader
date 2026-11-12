// Reproduce Docker's /app layout without needing a local Docker daemon.
// Keep the staged tree for inspection; never touches game/source directories.
import assert from 'node:assert/strict'
import {mkdtemp,cp,mkdir,readFile,symlink} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
const root=path.resolve('.'),stage=await mkdtemp(path.join(os.tmpdir(),'web-image-import-')),app=path.join(stage,'app')
await mkdir(app)
const dockerfile=await readFile('Dockerfile.web','utf8')
assert.match(dockerfile,/COPY web \.\/web/)
await cp('web',path.join(app,'web'),{recursive:true,filter:source=>!source.split(path.sep).includes('node_modules')})
await symlink(path.join(root,'web/node_modules'),path.join(app,'web/node_modules'),'dir')
// External application modules must be explicitly copied into the runtime tree.
for(const line of dockerfile.split('\n')){
 const m=/^COPY (scripts\/[^ ]+\.(?:mjs|gz)) (\.\/scripts\/[^ ]+\.(?:mjs|gz))$/.exec(line)
 if(m){const target=path.join(app,m[2]);await mkdir(path.dirname(target),{recursive:true});await cp(m[1],target)}
}
const result=spawnSync(process.execPath,['--input-type=module','-e',"await import('./web/library/types/gal.mjs')"],{cwd:app,encoding:'utf8'})
console.log('Staged image files retained:',stage)
assert.equal(result.status,0,result.stderr)
console.log('PASS production filesystem layout imports the Gal handler and all static dependencies')
