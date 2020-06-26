import { authState as fuckedAuthState } from 'rxfire/auth'
import { doc } from 'rxfire/firestore'
import { switchMap, filter, tap, catchError, startWith, pairwise, map } from 'rxjs/operators'
import { enforceAuth } from './features'

import firebase from 'firebase/app'
import 'firebase/auth'
import 'firebase/functions'
import 'firebase/firestore'
import { Observable, EMPTY } from 'rxjs'
import { Analysis, ServerResponse, RequestType, oauthDomains, PLFile } from './common'
import { browser } from 'webextension-polyfill-ts'
import { noop } from 'lodash'
import LRU from 'lru-cache'
import stringify from 'fast-json-stable-stringify'

firebase.initializeApp({
  apiKey: 'AIzaSyCrwVp9Lw8phXmDAkLlqy5PB4Im-sx8FMU',
  authDomain: 'codewyng.io',
  databaseURL: 'https://codewyng.firebaseio.com',
  projectId: 'codewyng',
  storageBucket: 'codewyng.appspot.com',
  messagingSenderId: '1002785187394',
  appId: '1:1002785187394:web:aa66b86659dd89bafeefdb',
  measurementId: 'G-Y63WHT9TYJ',
})

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

const visitedCommits = new LRU<string, boolean>({ max: 1000 })

const handlers: Record<RequestType, Parameters<typeof browser.runtime.onMessage.addListener>[0]> = {
  serverCall: async request => serverCall(request.args),
  touch: async (commit: { args: { owner: string; repo: string; commit: string } }) => {
    const key = stringify(commit)
    if (!visitedCommits.has(key)) {
      visitedCommits.set(key, true)
      return serverCall({
        kind: 'touch',
        ...commit.args,
      })
    }
  },
  loginToGithub: async () => {
    const result = await firebase.auth().signInWithPopup(new firebase.auth.GithubAuthProvider())
    if (!result.credential) throw new Error('no credential.accessToken')
    const oauth = (result.credential as any).accessToken
    if (!oauth) throw new Error('no credential.accessToken')
    if (!result.user) throw new Error('no user')
    await firebase.app().firestore().doc(`githubTokens/${result.user.uid}`).set({ oauth }, { merge: true })
  },
}

const unrecognized = async () => {
  throw new Error('unrecognized background script command')
}

async function serverRouter(): Promise<void> {
  browser.runtime.onMessage.addListener(
    async (request, sender) => await (handlers[request.kind] ?? unrecognized)(request, sender)
  )
}

// fuckedAuthState lies and says it'll never return `null`
const authState: (auth: firebase.auth.Auth) => Observable<firebase.User | null> = fuckedAuthState as any

const initLogin = async () => {
  if (oauthDomains.has(window.location.origin) && false) {
    authState(firebase.auth()).subscribe(async user => {
      if (!user) {
        await browser.browserAction.setTitle({ title: 'Log in to activate CodeWyng.' })
        await browser.browserAction.setBadgeText({ text: '1' })
        await browser.browserAction.setBadgeBackgroundColor({ color: '#F00' })
      } else {
        await browser.browserAction.setTitle({ title: 'CodeWyng is enabled.' })
        await browser.browserAction.setBadgeText({ text: '' })
      }
    })
  } else {
    await browser.browserAction.setTitle({ title: 'CodeWyng is enabled.' })
    await browser.browserAction.setBadgeText({ text: '' })
  }
}

const onInstalled = async () => {
  browser.runtime.onInstalled.addListener(async object => {
    if (object.reason === 'install') {
      await browser.tabs.create({ url: 'https://codewyng.io/installed_extension/' + browser.runtime.id })
      await browser.runtime.setUninstallURL('https://codewyng.io/uninstalled_extension/' + browser.runtime.id)
    }
  })
}

const background = async () => {
  await onInstalled()
  await initLogin()
  await serverRouter()
}

// tslint:disable-next-line: no-floating-promises
background()
