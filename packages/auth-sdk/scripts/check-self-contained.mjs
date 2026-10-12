// Gate de auto-contencion: el contrato `@eva_solutions/auth-contracts` es privado y nunca se publica,
// asi que el SDK lo incluye inlined. Falla (exit 1) si algun archivo de `dist` lo menciona o si el
// package.json lo declara como dependencies/peerDependencies.
//
// Uso: node scripts/check-self-contained.mjs [dist-dir]   (por defecto `dist`)
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const CONTRACT = '@eva_solutions/auth-contracts'
const EXTENSIONS = ['.d.ts', '.d.cts', '.js', '.cjs']

const distDir = resolve(process.argv[2] ?? 'dist')
const offenders = readdirSync(distDir, { withFileTypes: true, recursive: true })
  .filter((entry) => entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((file) => readFileSync(file, 'utf8').includes(CONTRACT))

const manifest = JSON.parse(readFileSync(resolve(distDir, '../package.json'), 'utf8'))
const declared = ['dependencies', 'peerDependencies'].filter(
  (field) => manifest[field]?.[CONTRACT] !== undefined,
)

for (const file of offenders) process.stderr.write(`dist file mentions ${CONTRACT}: ${file}\n`)
for (const field of declared) process.stderr.write(`package.json ${field} declares ${CONTRACT}\n`)
if (offenders.length > 0 || declared.length > 0) process.exit(1)
process.stdout.write(`self-contained: ${CONTRACT} not referenced\n`)
