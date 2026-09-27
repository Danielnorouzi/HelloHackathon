// House style: no em dashes (or spaced en dashes used like them) in user-facing UI text.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..')

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path)
    return /\.(jsx?|html)$/.test(name) ? [path] : []
  })
}

// Comments are for developers, not users.
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

describe('writing style', () => {
  it('user-facing source text has no em dashes', () => {
    const offenders = files(SRC).flatMap((file) => withoutComments(readFileSync(file, 'utf-8')).split('\n')
      .filter((line) => line.includes('—') || line.includes(' – '))
      .map((line) => `${file.replace(SRC, 'src')}: ${line.trim()}`))
    expect(offenders).toEqual([])
  })
})
