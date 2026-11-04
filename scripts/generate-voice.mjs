import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { recordings, hash } from './voice-text.mjs'
const output = process.env.VOICE_OUTPUT_DIR ? pathToFileURL(resolve(process.env.VOICE_OUTPUT_DIR) + sep) : new URL('../public/voice/', import.meta.url)
const engine = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021'
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const settings = { speedScale:1.05, volumeScale:1.4, outputSamplingRate:24000, outputStereo:false }
await mkdir(output, {recursive:true})
const speakers = await (await fetch(`${engine}/speakers`)).json()
const speaker = speakers.find(s=>s.name === '四国めたん')?.styles.find(s=>s.name === 'ノーマル')?.id
if (speaker === undefined) throw new Error('四国めたん（ノーマル）がエンジンに見つかりません')
const engineVersion = await (await fetch(`${engine}/version`)).json()
let manifest = { credit:'VOICEVOX:四国めたん', engineVersion, speaker, settings, files:{} }
try { manifest.files = JSON.parse(await readFile(new URL('manifest.json',output),'utf8')).files } catch {}
const shard = Number(process.env.VOICE_SHARD || 0)
const shards = Number(process.env.VOICE_SHARDS || 1)
const items = recordings().filter((_, i) => i % shards === shard)
for (const [index,item] of items.entries()) {
  const textHash = hash(item.text)
  const recipeHash = hash(JSON.stringify({textHash, engineVersion, speaker, settings}))
  const previous = manifest.files[item.file]
  if (previous?.recipeHash === recipeHash) {
    try { if (hash(await readFile(new URL(item.file,output))) === previous.sha256) continue } catch {}
  }
  const queryResponse = await fetch(`${engine}/audio_query?${new URLSearchParams({text:item.text,speaker:String(speaker)})}`,{method:'POST'})
  if (!queryResponse.ok) throw new Error(await queryResponse.text())
  const query = {...await queryResponse.json(), ...settings}
  const synthesis = await fetch(`${engine}/synthesis?speaker=${speaker}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query),signal:AbortSignal.timeout(120000)})
  if (!synthesis.ok) throw new Error(await synthesis.text())
  const wav = Buffer.from(await synthesis.arrayBuffer())
  const mp3 = spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i','pipe:0','-ac','1','-ar','24000','-codec:a','libmp3lame','-b:a','48k','-f','mp3','pipe:1'],{input:wav,maxBuffer:16*1024*1024,windowsHide:true})
  if (mp3.status !== 0) throw new Error(mp3.error?.message || mp3.stderr.toString())
  await writeFile(new URL(item.file,output),mp3.stdout)
  manifest.files[item.file]={textHash,recipeHash,sha256:hash(mp3.stdout),bytes:mp3.stdout.length}
  await writeFile(new URL('manifest.json',output),JSON.stringify(manifest,null,2)+'\n')
  console.log(`${index+1}/${items.length} ${item.file} ${mp3.stdout.length} bytes`)
}
console.log(`Done: ${items.length} recordings`)
