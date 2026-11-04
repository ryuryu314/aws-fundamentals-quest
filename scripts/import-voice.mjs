// Import only a complete set of matching, verified voice assets from the Actions workflow.
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { hash, recordings } from './voice-text.mjs'
const root = process.argv[2]
if (!root) throw new Error('Usage: node scripts/import-voice.mjs <directory containing voice-0 ... voice-7>')
const expected = new Map(recordings().map(x => [x.file, x.text]))
const imports = new Map()
let manifest, signature
for (const part of await readdir(resolve(root), {withFileTypes:true})) {
  if (!part.isDirectory() || !/^voice-\d+$/.test(part.name)) continue
  const dir = join(root, part.name)
  const {files, ...meta} = JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'))
  if (meta.credit !== 'VOICEVOX:四国めたん' || meta.speaker !== 2) throw new Error(`Unexpected voice in ${part.name}`)
  if (signature && signature !== JSON.stringify(meta)) throw new Error(`Recording settings differ: ${part.name}`)
  signature = JSON.stringify(meta); manifest = {...meta, files:{}}
  for (const [name, info] of Object.entries(files)) {
    if (!expected.has(name) || imports.has(name) || info.textHash !== hash(expected.get(name))) throw new Error(`Unexpected, outdated or duplicated recording: ${name}`)
    const file = join(dir,name), bytes = await readFile(file)
    if (hash(bytes)!==info.sha256 || bytes.length!==info.bytes) throw new Error(`Corrupt audio: ${name}`)
    imports.set(name, {file,info})
  }
}
if (!manifest || imports.size !== expected.size) throw new Error(`Incomplete: ${imports.size}/${expected.size} files`)
const out = new URL('../public/voice/', import.meta.url)
await mkdir(out,{recursive:true})
for (const name of [...expected.keys()].sort()) {
  const {file,info} = imports.get(name)
  await copyFile(file,new URL(name,out)); manifest.files[name] = info
}
await writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n')
console.log(`Imported ${imports.size} verified recordings`)
