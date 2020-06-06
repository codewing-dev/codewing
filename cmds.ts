#!/usr/bin/env ts-node

import { execSync } from 'child_process'

const e = s => execSync(s).toString()
const ie = s => execSync(s, { stdio: 'inherit' })

const cmds = {
  deploybrowser: () => {
    ie('yarn --cwd browser webpack')
    process.chdir('dist-prod')
    ie('zip codewyng-chrome-extension.zip *')
    e('open .')
    process.chdir('..')
  },
}

const main = async () => {
  const [cmdname] = process.argv.slice(2)
  if (!cmdname) {
    console.log(`Commands: ${Object.keys(cmds)}`)
    return
  } else {
    const cmd = cmds[cmdname]
    if (!cmd) throw new Error(`no command ${cmdname}, only ${Object.keys(cmds)}`)
    await cmd()
  }
}

// tslint:disable-next-line: no-floating-promises
main()
