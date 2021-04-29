import { browser, Storage } from 'webextension-polyfill-ts'
import { Observable } from 'rxjs'

export const observeStorage = <T>(key: string, defalt: T): Observable<T> =>
  new Observable(subscriber => {
    // tslint:disable-next-line: no-floating-promises
    browser.storage.local.get(key).then(obj => subscriber.next(key in obj ? obj[key] : defalt))
    const listener = (changes: { [s: string]: Storage.StorageChange }): void => {
      if (key in changes) {
        subscriber.next('newValue' in changes[key] ? changes[key].newValue : defalt)
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  })

export const setStorage = (key: string, value: any) => browser.storage.local.set({ [key]: value })
