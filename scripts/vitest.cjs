// Starts Vitest from a cwd whose drive letter is uppercase.
// On Windows a shell can start in "d:\followthru" while Node resolves modules as
// "D:\followthru"; Vitest then loads two copies of itself and every suite fails
// with "Cannot read properties of undefined (reading 'config')".
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const root = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase())
const cli = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
process.exit(result.status ?? 1)
