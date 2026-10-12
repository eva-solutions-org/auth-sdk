// Mide el tamaño gzip del cierre transitivo de imports del entry `react` del SDK, por separado
// para ESM (`react/index.js`, siguiendo `import`/`from`) y CJS (`react/index.cjs`, siguiendo
// `require("./...")`): el entry mas todos los chunks compartidos que importa, siguiendo solo
// especificadores relativos (los bare specifiers son externos y no cuentan).
//
// Uso: node scripts/react-closure-size.mjs <dist-dir> [--max <bytes>] [--max-cjs <bytes>] [--forbid <regex>]
// Imprime `{ esm, cjs }`; cada uno es `{ files, gzipBytes, perFile }` (`files` es un numero;
// `perFile` mapea cada archivo del cierre a su tamaño gzip). Sale con 1 si el gzipBytes de un formato
// supera su presupuesto (--max para ESM; --max-cjs para CJS, y si se omite aplica --max), o si el
// texto de algun archivo de cualquiera de los dos cierres cumple --forbid (el mensaje nombra el
// archivo). Un flag desconocido es un error: un gate que ignora un flag en silencio pasaria sin
// comprobar nada. Si falta uno de los dos entries, el script falla.
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const FORMATS = {
  esm: {
    entry: 'react/index.js',
    specifier: /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g,
  },
  cjs: {
    entry: 'react/index.cjs',
    specifier: /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  },
}

function measureReactClosure({ distDir, entryPath, specifier, forbid }) {
  const entry = resolve(distDir, entryPath)
  const seen = new Set()
  const queue = [entry]
  const perFile = {}
  const forbidden = []
  let gzipBytes = 0

  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)

    const source = readFileSync(file)
    const text = source.toString('utf8')
    const bytes = gzipSync(source, { level: 9 }).length
    gzipBytes += bytes
    perFile[relative(distDir, file).split('\\').join('/')] = bytes
    if (forbid?.test(text)) forbidden.push(relative(distDir, file).split('\\').join('/'))

    for (const [, target] of text.matchAll(specifier)) {
      queue.push(resolve(dirname(file), target))
    }
  }

  return { files: seen.size, gzipBytes, perFile, forbidden }
}

function parseArgs(argv) {
  const [distDir, ...rest] = argv
  if (!distDir) {
    throw new Error(
      'usage: react-closure-size.mjs <dist-dir> [--max <bytes>] [--max-cjs <bytes>] [--forbid <regex>]',
    )
  }

  let max
  let maxCjs
  let forbid
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]
    const value = rest[i + 1]
    if (flag === '--max' || flag === '--max-cjs') {
      const budget = Number(value)
      if (!Number.isInteger(budget) || budget < 0) {
        throw new Error(`${flag} requires a non-negative integer`)
      }
      if (flag === '--max') max = budget
      else maxCjs = budget
    } else if (flag === '--forbid') {
      if (!value) throw new Error('--forbid requires a regular expression')
      forbid = new RegExp(value)
    } else {
      throw new Error(`unknown argument: ${flag}`)
    }
  }
  return { distDir, budgets: { esm: max, cjs: maxCjs ?? max }, forbid }
}

const { distDir, budgets, forbid } = parseArgs(process.argv.slice(2))
const report = {}
let failed = false
for (const [format, { entry, specifier }] of Object.entries(FORMATS)) {
  const { forbidden, ...result } = measureReactClosure({
    distDir,
    entryPath: entry,
    specifier,
    forbid,
  })
  report[format] = result
  const budget = budgets[format]
  if (budget !== undefined && result.gzipBytes > budget) {
    process.stderr.write(
      `react closure (${format}) ${result.gzipBytes} B gzip exceeds budget ${budget} B\n`,
    )
    failed = true
  }
  for (const file of forbidden) {
    process.stderr.write(
      `react closure (${format}) file ${file} matches forbidden pattern ${forbid}\n`,
    )
    failed = true
  }
}
process.stdout.write(`${JSON.stringify(report)}\n`)
if (failed) process.exit(1)
