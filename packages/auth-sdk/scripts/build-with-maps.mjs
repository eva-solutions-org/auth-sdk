// Corre tsdown y garantiza que existan los mapas de declaraciones del entry principal.
// Motivo: tsdown 0.22 / rolldown-plugin-dts 0.25 a veces fusiona un chunk .d.ts en el
// index y omite dist/index.d.ts.map y dist/index.d.cts.map (falla ~60 % de las corridas).
// El JS sale siempre igual; solo se reintenta limpiando dist/.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAX_ATTEMPTS = 10
const REQUIRED_MAPS = ['dist/index.d.ts.map', 'dist/index.d.cts.map']
const tsdownBin = fileURLToPath(new URL('../node_modules/tsdown/dist/run.mjs', import.meta.url))

const log = (message) => process.stderr.write(`build-with-maps: ${message}\n`)

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = spawnSync(process.execPath, [tsdownBin, ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    log(`tsdown falló (${result.status ?? result.signal}).`)
    process.exit(result.status ?? 1)
  }

  const missing = REQUIRED_MAPS.filter((file) => !existsSync(file))
  if (missing.length === 0) process.exit(0)

  log(`intento ${attempt}/${MAX_ATTEMPTS} sin ${missing.join(', ')}; reintentando.`)
  rmSync('dist', { recursive: true, force: true })
}

log(
  `${MAX_ATTEMPTS} intentos sin generar ${REQUIRED_MAPS.join(' y ')}. ` +
    'Es el defecto conocido de tsdown/rolldown-plugin-dts; vuelve a correr el build.',
)
process.exit(1)
