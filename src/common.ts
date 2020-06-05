export const contains = (p: Position) => ({ line, characterStart, characterEnd }: Range): boolean =>
  line === p.line && characterStart <= p.char && p.char < characterEnd

export type Position = {
  line: number
  char: number
}

export type Range = {
  line: number
  characterStart: number
  characterEnd: number
}

export type Sym = SymT<PLFile & Range>
export type SymT<T> = { definition?: T; references: T[]; hover?: string }
export type Analysis = {
  symbols: Sym[]
}

export function allRanges(analysis: Analysis): Range[] {
  return [...analysis.symbols.flatMap(a => a.definition ?? []), ...analysis.symbols.flatMap(a => a.references)]
}

export type ServerResponse<T> = { error: string } | { data: T }
export type Stencil = Range[]

export type PLCommit = {
  owner: string
  repo: string
  commit: string
}
export type PLFile = {
  owner: string
  repo: string
  commit: string
  path: string
}

export type Auth = {
  token?: string
}

export type RequestType = 'serverCall' | 'touch' | 'loginToGithub'

export const mkPromise = <T>(): { promise: Promise<T>; resolve: (t: T) => void; reject: (e: any) => void } => {
  let letresolve: ((t: T) => void) | undefined = undefined
  let letreject: ((e: any) => void) | undefined = undefined
  const promise = new Promise<T>((givenResolve, givenReject) => {
    letresolve = givenResolve
    letreject = givenReject
  })
  const resolve: (t: T) => void = letresolve!
  const reject: (t: T) => void = letreject!
  return { promise, resolve, reject }
}

export function nextLine(strings: TemplateStringsArray) {
  return strings[0].slice(1)
}

export const mkCache = <Key, Value>({
  load,
  extract = () => [],
  toString,
}: {
  load: (key: Key) => Promise<Value>
  extract?: (t: Value) => Key[]
  toString: (key: Key) => string
}): ((key: Key) => Promise<Value>) => {
  // when extract returns, resolve pending promises OR insert Promise.resolve(T) into each key
  const m = new Map<string, { promise: Promise<Value>; resolve?: (value: Value) => void }>()
  return key0 => {
    const key = toString(key0)
    if (m.get(key)) {
      return m.get(key)!.promise
    } else {
      const { promise, resolve, reject } = mkPromise<Value>()
      m.set(key, { promise, resolve })
      // tslint:disable-next-line: no-floating-promises
      load(key0).then(
        t => {
          if ('resolve' in m.get(key)!) {
            m.set(key, { promise })
            resolve(t)

            for (const otherkey0 of extract(t)) {
              const otherkey = toString(otherkey0)
              const other = m.get(otherkey)
              if (!other) {
                m.set(otherkey, { promise })
              } else if (other.resolve) {
                m.set(otherkey, { promise })
                other.resolve(t)
              }
            }
          }
        },
        e => {
          m.delete(key)
          reject(e)
        }
      )
      return promise
    }
  }
}

export const oauthDomains = new Set(['chrome-extension://njkkfaliiinmkcckepjdmgbmjljfdeee'])

export const setUnion = <T>(...sets: Set<T>[]): Set<T> => {
  const x = new Set<T>()
  sets.forEach(s => s.forEach(e => x.add(e)))
  return x
}

export const setIntersection = <T>(...sets: Set<T>[]): Set<T> =>
  sets.reduce((a, b) => {
    const x = new Set<T>()
    b.forEach(v => {
      if (a.has(v)) x.add(v)
    })
    return x
  })

export const setDifference = <T>(...sets: Set<T>[]): Set<T> =>
  sets.reduce((a, b) => {
    const x = new Set<T>(a)
    b.forEach(v => {
      if (x.has(v)) x.delete(v)
    })
    return x
  })

export const examples = [
  { language: 'JavaScript', url: 'https://github.com/CodeWyng/codewyng/blob/master/example.js' },
  { language: 'TypeScript', url: 'https://github.com/CodeWyng/codewyng/blob/master/example.ts' },
  { language: 'Python', url: 'https://github.com/CodeWyng/codewyng/blob/master/example.py' },
  { language: 'Java', url: 'https://github.com/CodeWyng/codewyng/blob/master/example.java' },
  { language: 'Go', url: 'https://github.com/CodeWyng/codewyng/blob/master/example.go' },
]
