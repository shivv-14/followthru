// Runs the test suite from a lowercase drive path (Windows only) to prove npm test
// works however the shell spells the drive letter.
const { spawnSync } = require('node:child_process')

if (process.platform !== 'win32') {
  console.log('Not Windows: drive letter case does not apply.')
  process.exit(0)
}
const lower = process.cwd().replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
const result = spawnSync('npm test', { cwd: lower, shell: true, stdio: 'inherit' })
console.log(result.status === 0 ? `npm test passed from ${lower}` : `npm test FAILED from ${lower}`)
process.exit(result.status ?? 1)
