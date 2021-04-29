import {
  EMPTY,
  Observable,
  of,
  combineLatest,
  Subject,
  concat,
  ObservableInput,
  ObservedValueOf,
  OperatorFunction,
  merge,
  BehaviorSubject,
  noop,
  identity,
  from,
  fromEvent,
  Subscription,
  TeardownLogic,
  MonoTypeOperatorFunction,
} from 'rxjs'
import {
  distinctUntilChanged,
  map,
  switchMap,
  tap,
  startWith,
  mergeMap,
  concatMap,
  filter,
  mapTo,
  take,
  takeUntil,
  share,
  catchError,
  delay,
  sample,
  mergeMapTo,
  switchMapTo,
  debounceTime,
} from 'rxjs/operators'

export type Range = {
  beginLine: number
  beginCharacter: number
  endLine: number
  endCharacter: number
}

export type HoverResult = {
  startLine: number
  text: string
  highlights: { type: HighlightType; range: string }[]
}
export type HighlightType = 'comment' | 'string' | 'keyword' | 'highlight'

export type DefinitionResult = {
  file: string
  line: number
  column: number
  length: number
  hover: HoverResult
}

export const hoverColor = 'rgba(255, 179, 109, 0.5)'

export const renderHover = (arg: {
  file: string
  definition: DefinitionResult
  theme: Map<HighlightType, string>
}): Element => {
  const code = document.createElement('div')
  code.style.fontFamily = 'Menlo, monospace'
  code.style.fontSize = '12px'
  code.style.whiteSpace = 'pre-wrap'
  code.style.tabSize = '4'

  const hover = arg.definition.hover

  stripLeadingWhitespace(hover)

  const lineToIndex = new Map<number, number>()
  const lines = hover.text.split('\n')
  for (let i = 0, ix = 0; i < lines.length; ix += lines[i].length + 1, i++) lineToIndex.set(hover.startLine + i, ix)
  const pointToIx = (line: number, column: number): number => (lineToIndex.get(line) ?? 0) + column

  const ixlenty: [number, number, HighlightType][] = hover.highlights
    .map(highlight => {
      const range = stringToRange(highlight.range)
      const beginIx = pointToIx(range.beginLine, range.beginCharacter)
      const endIx = pointToIx(range.endLine, range.endCharacter)
      return [beginIx, endIx - beginIx, highlight.type] as [number, number, HighlightType]
    })
    .sort(([ixl], [ixr]) => ixl - ixr)

  let lastix = 0
  for (const [ix, len, ty] of ixlenty) {
    if (lastix === 0 && ix > 0) {
      code.appendChild(document.createTextNode(hover.text.slice(0, ix)))
      lastix = ix
    }
    if (ix > lastix) code.appendChild(document.createTextNode(hover.text.slice(lastix, ix)))
    const span = document.createElement('span')
    const color = arg.theme.get(ty)
    if (color) span.style.color = color
    if (ty === 'highlight') span.style.backgroundColor = hoverColor
    span.appendChild(document.createTextNode(hover.text.slice(ix, ix + len)))
    code.appendChild(span)
    lastix = ix + len
  }
  if (lastix < hover.text.length) code.appendChild(document.createTextNode(hover.text.slice(lastix, hover.text.length)))

  const container = document.createElement('div')
  container.append(code)
  const fileEl = document.createElement('span')
  fileEl.style.fontFamily = 'Menlo, monospace'
  const definedEl = document.createElement('div')
  definedEl.style.fontSize = '10px'
  definedEl.style.color = 'gray'
  if (arg.file === arg.definition.file) {
    definedEl.appendChild(document.createTextNode('Defined on line '))
    fileEl.appendChild(document.createTextNode(`${arg.definition.line + 1}`))
  } else {
    definedEl.appendChild(document.createTextNode('Defined in '))
    fileEl.appendChild(document.createTextNode(arg.definition.file))
  }
  definedEl.appendChild(fileEl)
  container.appendChild(definedEl)

  return container
}

export const stripLeadingWhitespace = (hover: HoverResult): void => {
  const lines = hover.text.split('\n')
  const column = (i: number): Set<string> =>
    lines.reduce((acc, v) => (i < v.length ? acc.add(v[i]) : acc), new Set<string>())
  let len = 0
  let kind: '\t' | ' ' | undefined = undefined
  for (let i = 0; ; i++) {
    const chars = column(i)
    if (chars.size !== 1) break
    const char = [...chars.values()][0]
    if ((kind && char !== kind) || !(char === '\t' || char === ' ')) break
    len++
    kind = char
  }

  hover.text = hover.text
    .split('\n')
    .map(line => line.slice(len))
    .join('\n')
  for (const highlight of hover.highlights) {
    const range = stringToRange(highlight.range)
    range.beginCharacter -= len
    range.endCharacter -= len
    highlight.range = rangeToString(range)
  }
}

export const stringToRange = (range: string): Range => {
  const [begin, end] = range.split('-')
  const [beginLineStr, beginCharacter] = begin.split(':')
  const [endLineStr, endCharacter] = end.split(':')
  return {
    beginLine: parseInt(beginLineStr),
    beginCharacter: parseInt(beginCharacter),
    endLine: parseInt(endLineStr),
    endCharacter: parseInt(endCharacter),
  }
}

export const rangeToString = (range: Range): string =>
  `${range.beginLine}:${range.beginCharacter}-${range.endLine}:${range.endCharacter}`

export const observeAttribute = (el: Element, attribute: string): Observable<string | undefined> =>
  concat(
    of(el.getAttribute(attribute) ?? undefined),
    observeMutations(el, { attributes: true, attributeFilter: [attribute] }).pipe(
      concatMap(records =>
        records.slice(-1).map(record => (record.target as Element).getAttribute(attribute) ?? undefined)
      )
    )
  )

/**
 * - Emits an "inner" `Observable<Node>` whenever a `Node` at the given path relative to the start is added to the DOM.
 * - Each "inner" `BehaviorSubject<Node>` emits exactly 1 `Node` and completes when the `Node` is removed.
 * - `path` is a sequence of CSS selectors which filter the direct children to recurse into. For example, a `path` of length 5 will match nodes 5 levels deep in the DOM.
 *
 * Example: `observeSelector(document.body, path: ["div", ".foo"])`
 *
 * - `<div><p class="foo"></p></div>` ✅ match
 * - `<div><div><p class="foo"></p></div></div>` ❌ no match
 */
export const observeSelector = (start: Node, path: string[]): Observable<Observable<Element>> => {
  const [selector0, ...restOfSelectors] = path
  if (selector0 === undefined) throw new Error('expected at least one selector')

  const elementToSubject = new Map<Element, Subject<Element>>()

  return observeChildren(start).pipe(
    filter((child): child is Delta<Element> => child.value instanceof Element && child.value.matches(selector0)),
    mergeMap(({ value: el, brand }) => {
      switch (brand) {
        case 'added': {
          const subject = new BehaviorSubject<Element>(el)
          elementToSubject.set(el, subject)
          return of(subject)
        }
        case 'removed': {
          const subject = elementToSubject.get(el)
          if (!subject) {
            console.error('bug: no subject for node', el)
            return EMPTY
          } else {
            elementToSubject.delete(el)
            subject.complete()
            return EMPTY
          }
        }
        default:
          throw new Error('unrecognized brand ' + brand)
      }
    }),
    restOfSelectors.length > 0 ? mergeSwitchCompleteMap(element => observeSelector(element, restOfSelectors)) : identity
  )
}

/** `mergeMap(o => o.pipe(switchCompleteMap(f)))`, convenient for operating on the result of `observeSelector` */
export const observeSelectorMap = <T>(
  start: Node,
  path: string[],
  f: (t: Element) => ObservableInput<T>
): Observable<T> => observeSelector(start, path).pipe(mergeSwitchCompleteMap(f))

/** Like `switchMap`, but also unsubscribes the inner `Observable` upon source completion. */
export const switchCompleteMap: typeof switchMap = <T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O
): OperatorFunction<T, ObservedValueOf<O>> => o => {
  const SENTINEL = Symbol('SENTINEL')
  return concat(o, of(SENTINEL)).pipe(switchMap((v, i) => (v === SENTINEL ? EMPTY : project(v, i))))
}

/** Like `switchMap`, but also unsubscribes the inner `Observable` upon source completion. */
export const mergeSwitchCompleteMap = <T, O extends ObservableInput<any>>(
  project: (value: T, index: number) => O
): OperatorFunction<Observable<T>, ObservedValueOf<O>> => o =>
  o.pipe(mergeMap(o2 => o2.pipe(switchCompleteMap(project))))

/** The addition or removal of a `Node` */
type Delta<T> = { brand: 'added' | 'removed'; value: T }

/** Emits each child of the given parent (and the shadow root, if it exists) immediately upon call, then emits children as they get added or removed. */
export const observeChildren = (parent: Node): Observable<Delta<Node>> => {
  const parents = [parent, ...(parent instanceof Element && parent.shadowRoot ? [parent.shadowRoot] : [])]

  return concat(
    ...parents.flatMap(p => Array.from(p.childNodes)).map(child => of({ brand: 'added', value: child } as Delta<Node>)),
    merge(...parents.map(t => observeMutations(t, { childList: true }))).pipe(
      concatMap(records =>
        records.flatMap(({ addedNodes, removedNodes }) => [
          ...Array.from(addedNodes).map(node => ({ brand: 'added' as 'added', value: node } as Delta<Node>)),
          ...Array.from(removedNodes).map(node => ({ brand: 'removed' as 'removed', value: node } as Delta<Node>)),
        ])
      )
    )
  )
}

/** An `Observable` wrapper around a `MutationObserver` */
export const observeMutations = (target: Node, options?: MutationObserverInit): Observable<MutationRecord[]> =>
  new Observable(subscriber => {
    const mutationObserver = new MutationObserver(mutationRecords => subscriber.next(mutationRecords))
    mutationObserver.observe(target, options)
    return () => mutationObserver.disconnect()
  })
