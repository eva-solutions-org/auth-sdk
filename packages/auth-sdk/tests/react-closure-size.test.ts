import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(
  new URL('../scripts/react-closure-size.mjs', import.meta.url),
)

let dist: string

type Report = {
  files: number
  gzipBytes: number
  perFile: Record<string, number>
}

/**
 * Fake dist. ESM: `react/index.js` -> `./shared.js` -> `./schema.js` (the only file with `.meta(`).
 * CJS: `react/index.cjs` -> `./shared.cjs` and `./runtime.cjs` -> `./schema.cjs` (same shape as the
 * real regression: the entry side-effect-requires a runtime chunk that drags in schemas).
 */
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'closure-size-'))
  mkdirSync(join(dist, 'react'))
  writeFileSync(
    join(dist, 'react/index.js'),
    'import { a } from "../shared.js"\nexport { a }\n',
  )
  writeFileSync(
    join(dist, 'shared.js'),
    'import "./schema.js"\nexport const a = 1\n',
  )
  writeFileSync(
    join(dist, 'schema.js'),
    'import { z } from "zod"\nz.string().meta({ id: "X" })\n',
  )
  writeFileSync(
    join(dist, 'react/index.cjs'),
    'require("../runtime.cjs")\nconst s = require("../shared.cjs")\nexports.a = s.a\n',
  )
  writeFileSync(
    join(dist, 'runtime.cjs'),
    'const z = require("zod")\nconst c = require("./schema.cjs")\n',
  )
  writeFileSync(join(dist, 'shared.cjs'), 'exports.a = 1\n')
  writeFileSync(
    join(dist, 'schema.cjs'),
    'const z = require("zod")\nz.z.string().meta({ id: "X" })\n',
  )
})

afterEach(() => {
  rmSync(dist, { recursive: true, force: true })
})

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, dist, ...args], {
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function report(stdout: string) {
  return JSON.parse(stdout) as { esm: Report; cjs: Report }
}

describe('react-closure-size script', () => {
  it('walks ESM imports and CJS requires separately, with files as a number plus perFile sizes', () => {
    const { status, stdout } = run()

    const { esm, cjs } = report(stdout)
    expect(status).toBe(0)
    expect(esm.files).toBe(3)
    expect(Object.keys(esm.perFile).sort()).toEqual([
      'react/index.js',
      'schema.js',
      'shared.js',
    ])
    expect(cjs.files).toBe(4)
    expect(Object.keys(cjs.perFile).sort()).toEqual([
      'react/index.cjs',
      'runtime.cjs',
      'schema.cjs',
      'shared.cjs',
    ])
    for (const closure of [esm, cjs]) {
      expect(closure.gzipBytes).toBe(
        Object.values(closure.perFile).reduce((sum, bytes) => sum + bytes, 0),
      )
    }
  })

  it('--max applies to ESM and, absent --max-cjs, to CJS too', () => {
    const { esm, cjs } = report(run().stdout)
    const exact = Math.max(esm.gzipBytes, cjs.gzipBytes)

    expect(run('--max', String(exact)).status).toBe(0)
    const over = run('--max', String(exact - 1))
    expect(over.status).toBe(1)
    expect(over.stderr).toContain('exceeds budget')
  })

  it('--max-cjs sets its own CJS budget independent of the ESM one', () => {
    const { esm, cjs } = report(run().stdout)
    expect(cjs.gzipBytes).not.toBe(esm.gzipBytes)

    const esmBudget = String(esm.gzipBytes)
    expect(
      run('--max', esmBudget, '--max-cjs', String(cjs.gzipBytes)).status,
    ).toBe(0)

    const cjsOver = run(
      '--max',
      esmBudget,
      '--max-cjs',
      String(cjs.gzipBytes - 1),
    )
    expect(cjsOver.status).toBe(1)
    expect(cjsOver.stderr).toContain('(cjs)')
    expect(cjsOver.stderr).not.toContain('(esm)')

    const esmOver = run(
      '--max',
      String(esm.gzipBytes - 1),
      '--max-cjs',
      String(cjs.gzipBytes),
    )
    expect(esmOver.status).toBe(1)
    expect(esmOver.stderr).toContain('(esm)')
  })

  it('--forbid fails naming the closure file whose text matches, in both formats', () => {
    const hit = run('--forbid', '\\.meta\\(')

    expect(hit.status).toBe(1)
    expect(hit.stderr).toContain('(esm) file schema.js')
    expect(hit.stderr).toContain('(cjs) file schema.cjs')
    expect(hit.stderr).not.toContain('shared.js')
    expect(hit.stderr).not.toContain('shared.cjs')
  })

  it('--forbid catches a CJS-only leak even when the ESM closure is clean', () => {
    writeFileSync(join(dist, 'shared.js'), 'export const a = 1\n')

    const hit = run('--forbid', '\\.meta\\(')

    expect(hit.status).toBe(1)
    expect(hit.stderr).toContain('(cjs) file schema.cjs')
    expect(hit.stderr).not.toContain('(esm)')
  })

  it('--forbid passes when no closure file matches', () => {
    expect(run('--forbid', 'never-present-token').status).toBe(0)
  })

  it('fails when the CJS entry is missing instead of measuring only ESM', () => {
    rmSync(join(dist, 'react/index.cjs'))

    expect(run().status).not.toBe(0)
  })

  it('an unknown flag is an error, never silently ignored', () => {
    const { status, stderr } = run('--frobid', 'x')

    expect(status).not.toBe(0)
    expect(stderr).toContain('unknown argument')
  })
})
