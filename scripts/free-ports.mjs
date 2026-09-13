import { execFileSync } from 'node:child_process'

const ports = process.argv.slice(2).map(Number).filter(Number.isInteger)

for (const port of ports) {
  let output = ''
  try {
    output = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    continue
  }

  for (const value of output.split(/\s+/).filter(Boolean)) {
    const pid = Number(value)
    if (!Number.isInteger(pid) || pid === process.pid) continue
    try {
      process.kill(pid, 'SIGTERM')
      console.log(`[dev] stopped existing process ${pid} on port ${port}`)
    } catch (error) {
      if (error?.code === 'EPERM') {
        console.warn(`[dev] cannot stop process ${pid} on port ${port}; check it manually`)
        continue
      }
      if (error?.code !== 'ESRCH') throw error
    }
  }
}
