import { RequestType } from './common'
import { browser } from 'webextension-polyfill-ts'
import LRU from 'lru-cache'

declare const DEV: boolean

declare const SERVER_URL: string

const serverCall = async (args: any): Promise<any> => {
  const response: any = await (
    await fetch(SERVER_URL, {
      method: 'POST',
      body: JSON.stringify(args),
    })
  ).json()

  if ('error' in response) throw new Error(response.error)
  else return response.data
}

const handlers: Record<RequestType, Parameters<typeof browser.runtime.onMessage.addListener>[0]> = {
  serverCall: async request => serverCall(request.args),
}

const unrecognized = async () => {
  throw new Error('unrecognized background script command')
}

async function serverRouter(): Promise<void> {
  browser.runtime.onMessage.addListener(
    async (request: { kind: RequestType }, sender) => await (handlers[request.kind] ?? unrecognized)(request, sender)
  )
}

const onInstalled = async () => {
  browser.runtime.onInstalled.addListener(async object => {
    if (object.reason === 'install' && !DEV) {
      await browser.tabs.create({ url: 'https://codewing.dev/installed_extension' })
      await browser.runtime.setUninstallURL('https://codewing.dev/uninstalled_extension')
    }
  })
}

const background = async () => {
  await onInstalled()
  await serverRouter()
}

// tslint:disable-next-line: no-floating-promises
background()
