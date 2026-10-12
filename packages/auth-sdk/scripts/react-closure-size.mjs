// Mide el tamaño gzip del cierre transitivo de imports del entry `react` del SDK:
// el entry mas todos los chunks compartidos que importa, siguiendo solo especificadores
// relativos (los bare specifiers son externos y no cuentan).
//
// Uso: node scripts/react-closure-size.mjs <dist-dir> [--max <bytes>]
// Imprime `{ files, gzipBytes }` y sale con 1 si gzipBytes supera --max.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g

function measureReactClosure(distDir) {
  const entry = resolve(distDir, 'react/index.js')
  const seen = new Set()
  const queue = [entry]
  let gzipBytes = 0

  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)

    const source = readFileSync(file)
    gzipBytes += gzipSync(source, { level: 9 }).length

    for (const [, specifier] of source.toString('utf8').matchAll(RELATIVE_SPECIFIER)) {
      queue.push(resolve(dirname(file), specifier))
    }
  }

  return { files: seen.size, gzipBytes }
}

function parseArgs(argv) {
  const [distDir, ...rest] = argv
  if (!distDir) throw new Error('usage: react-closure-size.mjs <dist-dir> [--max <bytes>]')

  const maxIndex = rest.indexOf('--max')
  if (maxIndex === -1) return { distDir, max: undefined }

  const max = Number(rest[maxIndex + 1])
  if (!Number.isInteger(max) || max < 0) throw new Error('--max requires a non-negative integer')
  return { distDir, max }
}

const { distDir, max } = parseArgs(process.argv.slice(2))
const result = measureReactClosure(distDir)
process.stdout.write(`${JSON.stringify(result)}\n`)

if (max !== undefined && result.gzipBytes > max) {
  process.stderr.write(`react closure ${result.gzipBytes} B gzip exceeds budget ${max} B\n`)
  process.exit(1)
}
