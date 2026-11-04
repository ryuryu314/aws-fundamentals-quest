import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Only a short cache version belongs in the JS bundle. The actual voice files stay static.
const voiceVersion = createHash('sha256')
  .update(readFileSync(new URL('./public/voice/manifest.json', import.meta.url)))
  .digest('hex').slice(0, 12)

export default defineConfig({
  base: './', plugins: [react()],
  define: { 'import.meta.env.VITE_VOICE_VERSION': JSON.stringify(voiceVersion) },
})
