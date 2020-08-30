import $ from 'jquery'
import { BinTree, Iterator as BinTreeIterator } from 'bintrees'
import {
  fromEvent,
  Observable,
  MonoTypeOperatorFunction,
  OperatorFunction,
  of,
  Subject,
  merge,
  EMPTY,
  Subscribable,
  Subscription,
  TeardownLogic,
  concat,
  from,
  Unsubscribable,
} from 'rxjs'
import {
  map,
  distinctUntilChanged,
  filter,
  debounceTime,
  mapTo,
  switchMap,
  tap,
  withLatestFrom,
  startWith,
  mergeMap,
  concatMap,
  reduce,
  ignoreElements,
  expand,
  scan,
  catchError,
  take,
  switchMapTo,
} from 'rxjs/operators'
import { isEqual, once, uniq, compact, noop, groupBy, entries, mapValues, orderBy } from 'lodash'
import tippy, { Props, Tippy, createSingleton, Instance } from 'tippy.js'
import { mouseRest } from './tippy-mouse-rest'
import {
  Analysis,
  Position,
  Range,
  Sym,
  allRanges,
  ServerResponse,
  PLFile,
  Stencil,
  contains,
  mkCache,
  Auth,
  SymT,
} from './common'
import { browser } from 'webextension-polyfill-ts'
import stringify from 'fast-json-stable-stringify'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
const md = new MarkdownIt({
  linkify: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(lang, str).value
      } catch (e) {
        return ''
      }
    } else {
      return ''
    }
  },
})
import hotkeys from 'hotkeys-js'
import DialogTitle from '@material-ui/core/DialogTitle'
import Dialog from '@material-ui/core/Dialog'
import DialogContent from '@material-ui/core/DialogContent'
import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { DialogContentText, makeStyles, Theme, createStyles, fade, Input, Typography } from '@material-ui/core'
import SearchIcon from '@material-ui/icons/Search'
import InputBase from '@material-ui/core/InputBase'
import Highlighter from 'react-highlight-words'
import ReactMarkdown from 'react-markdown'
import _ from 'lodash'

import { useEventCallback } from 'rxjs-hooks'

import { setStorage, observeStorage, observeUnderlineVariables } from './utils'

function textWidth(text: string, font: string) {
  const element = document.createElement('canvas')
  const context = element.getContext('2d')
  if (!context) throw new Error('could not get canvas context')
  context.font = font
  return context.measureText(text).width
}

function findHoverCharacter({
  contentX,
  text,
  characterWidth,
  tabSize,
}: {
  contentX: number
  text: string
  characterWidth: number
  tabSize: number
}) {
  if (contentX < 0) return undefined
  // Neither `caretPositionFromPoint` nor `caretRangeFromPoint` work because they
  // both return offsets BETWEEN characters, which are off by 1 when the cursor is
  // hovering over the second half of the character.
  let x = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\t') x = characterWidth * Math.floor(x / characterWidth / tabSize + 1) * tabSize
    else x += characterWidth
    if (x > contentX) {
      return i
    }
  }
  return undefined
}

type PositionWithKind = Position & { kind: LineSpec['kind'] }

// TODO see if you can return the actual commit here instead of kind, could enable you to split findLineNumber into 3 functions (diff/blame/normal)
function positions(): OperatorFunction<MouseEvent, PositionWithKind | undefined> {
  const constants = once((blobCodeInner: HTMLElement) => {
    const { paddingLeft, font } = window.getComputedStyle(blobCodeInner, null)
    const tabSizeString = blobCodeInner.closest('[data-tab-size]')?.getAttribute('data-tab-size')
    if (!tabSizeString) {
      console.warn('positions: unable to determine tab size')
      return undefined
    }
    return {
      paddingLeft: parseFloat(paddingLeft),
      characterWidth: textWidth('x', font),
      tabSize: parseInt(tabSizeString),
    }
  })

  function computePosition(event: MouseEvent): PositionWithKind | undefined {
    const blobCodeInner = (event.target as HTMLElement).closest<HTMLElement>('.blob-code-inner')
    if (!blobCodeInner) {
      // Cursor is nowhere in the file
      return
    }
    spannify(blobCodeInner)
    const firstEl = blobCodeInner.children[0]
    if (!firstEl) {
      // No text on this line
      return
    }

    const computedConstants = constants(blobCodeInner)
    if (!computedConstants) return undefined
    const { characterWidth, tabSize } = computedConstants
    const text = textContent(blobCodeInner)
    const leftEl = text.startsWith('\t') ? blobCodeInner : firstEl
    const contentX =
      event.clientX - (leftEl.getBoundingClientRect().left + parseFloat(window.getComputedStyle(leftEl).paddingLeft))

    const line = findLineNumber(blobCodeInner)
    if (line === undefined) return

    const char = findHoverCharacter({
      contentX,
      text: textContent(blobCodeInner),
      characterWidth,
      tabSize,
    })
    if (char === undefined) return
    if (char >= text.length) return

    return {
      line: line.line,
      kind: line.kind,
      char,
    }
  }

  return observable => observable.pipe(map(computePosition), unique())
}

// Alternative idea that could work: either over- or under- laying a copy of the `td` with the same text but with this CSS:
//
//     color: transparent` could work
//     position: absolute;
//     left: 0;
//     user-select: none;
//     pointer-events: none;
//
// See https://jsfiddle.net/436asvfL/8/
//
// Downsides include needing to handle hover on/off myself and programmatically call tippy.show()/hide().
//
// Instead, I plan to to cut up the line by hover ranges and install tippy on those pieces.

function textContent(node: Node | HTMLElement): string {
  return (node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent) ?? ''
}

function splitAt(lineel: HTMLElement, char: number): void {
  const node = nodeAtChar(Array.from(lineel.childNodes), char)
  if (char !== node.start && char !== node.start + textContent(node.el).length) {
    const offset = char - node.start

    const l = node.el.cloneNode(false)
    const r = node.el.cloneNode(false)
    if (node.el.nodeType === Node.TEXT_NODE) {
      l.nodeValue = textContent(node.el).substring(0, offset)
      r.nodeValue = textContent(node.el).substring(offset)
    } else {
      l.appendChild(document.createTextNode(textContent(node.el).substring(0, offset)))
      r.appendChild(document.createTextNode(textContent(node.el).substring(offset)))
    }
    ;(node.el as ChildNode).replaceWith(l, r)
  }
}

function iterAtChar<T extends Node | HTMLElement>(
  nodes: Iterable<T>,
  char: number
): BinTreeIterator<{ start: number; el: T }> {
  const tree = new BinTree<{ start: number; el: T }>(({ start: start1 }, { start: start2 }) => start1 - start2)
  let i = 0
  for (const el of nodes) {
    tree.insert({ el: el, start: i })
    i += textContent(el).length
  }
  // Do not use `lowerBound`! It's merely a synonym for `upperBound`.
  // it's ok to omit `el` because the comparison function above doesn't use it
  // could change BinTree's API to not require a whole value
  const iter = tree.upperBound({ start: char } as any)
  iter.prev()
  return iter
}

function nodeAtChar<T extends Node | HTMLElement>(nodes: Iterable<T>, char: number): { start: number; el: T } {
  return iterAtChar(nodes, char).data()
}

function selectRange(blobCodeInner: HTMLElement, start: number, end: number): HTMLElement[] {
  spannify(blobCodeInner)
  splitAt(blobCodeInner, start)
  splitAt(blobCodeInner, end)
  const nodes: HTMLElement[] = []
  for (
    // Cast is OK because applyAnalysis() and spannify() have been called by now. All children are spans.
    const iter = iterAtChar(Array.from(blobCodeInner.childNodes) as HTMLElement[], start);
    iter.data() !== null && iter.data().start < end;
    iter.next()
  ) {
    nodes.push(iter.data().el)
  }
  return nodes
}

declare let currentTippys: Instance[]
;(window as any).currentTippys = []

type LineSpec = { line: number; kind: 'normal' | 'context' | 'addition' | 'deletion' }
const findLineNumber = (blobCodeInner: HTMLElement): LineSpec | undefined => {
  const tr = blobCodeInner.closest('tr')
  if (!tr) {
    // probably a blame view
    const lineString = blobCodeInner.getAttribute('id')
    if (!lineString) return undefined
    return {
      line: parseInt(lineString.slice(2)) - 1,
      kind: 'normal',
    }
  }

  const resolve = (kind: LineSpec['kind'], blobNum: HTMLElement | null): LineSpec | undefined => {
    if (!blobNum) return undefined
    const str = blobNum.getAttribute('data-line-number')
    if (str === null) return undefined
    try {
      return {
        kind,
        line: parseInt(str) - 1,
      }
    } catch (e) {
      return undefined
    }
  }

  return (
    resolve('addition', tr.querySelector('.blob-num.blob-num-addition[data-line-number]')) ??
    resolve('deletion', tr.querySelector('.blob-num.blob-num-deletion[data-line-number]')) ??
    resolve('context', tr.querySelector('.blob-num.blob-num-context[data-line-number]')) ??
    resolve('normal', tr.querySelector('.blob-num[data-line-number]'))
  )
}

const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g

function initCSS() {
  const style = document.createElement('style')
  document.head.appendChild(style)
  const sheet = style.sheet as CSSStyleSheet
  sheet.insertRule('.senpai { background-color: rgba(255, 179, 109, 0.5) !important }')
  sheet.insertRule('.senpai2 { background-color: white; transition: background-color 2000ms linear !important }')
  sheet.insertRule('.codewyng-clickable { cursor: pointer }')
  sheet.insertRule(`.codewyng-highlightable {
    text-decoration: underline;
    text-decoration-style: dashed;
    text-decoration-color: gray;
  }`)

  // !important so it shows up even on word diffs.
  sheet.insertRule('.codewyng-highlighted { background-color: rgba(255, 179, 109, 0.5) !important }')
  // const rule = sheet.cssRules[0] as CSSStyleRule
  // rule.style.backgroundColor = hlColor
  // rule.style.transition = 'background-color 0ms linear'
}

function matchIntervals({
  re,
  lineContent,
}: {
  re: RegExp
  lineContent: string
}): (Omit<Range, 'line'> & { token: string })[] {
  const ar: (Omit<Range, 'line'> & { token: string })[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(lineContent)) !== null) {
    const b = match[0]
    ar.push({
      token: match[0],
      characterStart: match.index,
      characterEnd: match.index + b.length,
    })
  }
  return ar
}

function indexTokens(linesContent: string[]): Map<string, Range[]> {
  const token2ranges = new Map<string, Range[]>()
  linesContent.forEach((line, linen) => {
    for (const { token, characterStart, characterEnd } of matchIntervals({
      re: wordRegex,
      lineContent: line,
    })) {
      const ranges = token2ranges.get(token) ?? []
      token2ranges.set(token, ranges)
      ranges.push({
        line: linen,
        characterStart,
        characterEnd,
      })
    }
  })
  return token2ranges
}

// To merge highlights of different colors, edit the style sheet and
// for each combination of overlapping colors, create a CSS rule with:
//
// ```css
// .red-blue {
//   background-image:
//     linear-gradient(to right, rgb(255, 0, 0, 0.2), rgb(255, 0, 0, 0.2)),
//     linear-gradient(to right, rgb(0, 0, 255, 0.2), rgb(0, 0, 255, 0.2))
//     ;
// }
// ```

function filterDefined<T>(source: Observable<T | undefined>): Observable<T> {
  return source.pipe(filter((x): x is T => x !== undefined))
}

function unique<T>(): MonoTypeOperatorFunction<T> {
  return distinctUntilChanged(isEqual)
}

function uniqueBy<T>(f: (t: T) => any): MonoTypeOperatorFunction<T> {
  return distinctUntilChanged((a, b) => isEqual(f(a), f(b)))
}

function bind<T, U>(f: (t: T) => U): (mt: T | undefined) => U | undefined {
  return mt => (mt === undefined ? undefined : f(mt))
}

const senpai = (scrollEl: HTMLElement, highlightEl: HTMLElement, kind: 'center' | 'nearest') => {
  highlightEl.classList.add('senpai')
  scrollEl.scrollIntoView({
    behavior: 'smooth', // auto/smooth
    block: kind,
  })
  const intersectionObserver = new IntersectionObserver(isectentries => {
    const [entry] = isectentries
    if (entry.isIntersecting) {
      highlightEl.classList.add('senpai2')
      highlightEl.classList.remove('senpai')
      setTimeout(() => {
        highlightEl.classList.remove('senpai2')
      }, 2000)
    }
  })
  // start observing
  intersectionObserver.observe(scrollEl)
}

const determineFile = (): RepoCommitPath => {
  const permalink = $1('[data-hotkey="y"]')
  if (!permalink) {
    throw new Error('expected to find permalink on page')
  }
  let permalinkHref = permalink.getAttribute('href')
  if (!permalinkHref) {
    throw new Error('expected permalink to have href')
  }
  if (/^https:/.test(permalinkHref)) {
    permalinkHref = new URL(permalinkHref).pathname
  }
  const [_ignore, owner, repo, _blob, commit, ...fileparts] = permalinkHref.split('/')
  const path = fileparts.join('/')
  return { owner, repo, commit, path }
}

// same as determineFile, but ignores fileparts (it's either .../<blob|tree|commit>/...)
const determineCommit = (): { owner: string; repo: string; commit: string; ref?: string } => {
  const permalink = $1('[data-hotkey="y"]')
  if (!permalink) {
    throw new Error('expected to find permalink on page')
  }
  let permalinkHref = permalink.getAttribute('href')
  if (!permalinkHref) {
    throw new Error('expected permalink to have href')
  }
  if (/^https:/.test(permalinkHref)) {
    permalinkHref = new URL(permalinkHref).pathname
  }
  const [_ignore, owner, repo, _treeOrBlob, commit] = permalinkHref.split('/')

  const branchSelect = $1('[data-hotkey="w"]')
  const onBranch = branchSelect?.querySelector('i')?.textContent === 'Branch:'
  const title = branchSelect?.getAttribute('title')
  const buttonText = branchSelect?.querySelector('[data-menu-button]')?.textContent ?? undefined
  let ref: string | undefined
  if (onBranch && title === 'Switch branches or tags') ref = `refs/heads/${buttonText}`
  if (onBranch && title !== 'Switch branches or tags') ref = `refs/heads/${title}`

  return { owner, repo, commit, ref }
}

const auth = async (): Promise<Auth> => {
  const token = (await browser.storage.local.get('githubAccessToken'))['githubAccessToken']
  return token ? { token } : {}
}

const $1 = function (selector: string): HTMLElement | undefined {
  return (document.querySelector(selector) ?? undefined) as HTMLElement | undefined
}
const $n = function (selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector))
}

const fetchStencil = async (repoCommitPath: RepoCommitPathMRef): Promise<Stencil> =>
  await browser.runtime.sendMessage({
    kind: 'serverCall',
    args: { kind: 'stencil', ...repoCommitPath, ...(await auth()) },
  })

const mkSymbolAt = (): {
  symbolAt: (range: RepoCommitPathRange) => Promise<Sym | undefined>
  symbols: Observable<Sym>
} => {
  const symbols = new Subject<Sym>()
  const fetchSymbolAt = async (range: RepoCommitPathRange): Promise<Sym | undefined> => {
    const s: Sym | undefined = await browser.runtime.sendMessage({
      kind: 'serverCall',
      args: {
        kind: 'symbolAt',
        ..._.pick(range, ['owner', 'repo', 'commit', 'path', 'line', 'ref']),
        char: range.characterStart,
        ...(await auth()),
      },
    })
    if (s) {
      symbols.next(s)
    }
    return s
  }
  const get = mkCache<RepoCommitPathRange, Sym | undefined>({
    load: fetchSymbolAt,
    extract: symbolRanges,
    toString: stringify,
  })
  return {
    symbolAt: get,
    symbols,
  }
}

function spannify(blobCodeInner: HTMLElement): void {
  for (const child of Array.from(blobCodeInner.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const span = document.createElement('span')
      span.appendChild(document.createTextNode(textContent(child)))
      child.parentElement!.replaceChild(span, child)
    }
  }
}

const symbolRanges = <R extends RepoCommitPathRange>(symbol: SymT<R> | undefined): R[] =>
  symbol ? compact([symbol.definition, ...symbol.references]) : []

const disableGitHubNative = () => {
  const e = $1('.highlight')
  if (e) {
    e.classList.remove('highlight')
    e.classList.add('js-code-block-container')
  }
}

const isPublic = () => {
  return (
    document.querySelector('head > meta[name="octolytics-dimension-repository_public"]')?.getAttribute('content') ===
    'true'
  )
}

const tippystyleprops: Partial<Props> = {
  theme: 'light-border',
  maxWidth: '500px',
  placement: 'top-start',
  // plugins: [mouseRest],
  duration: 50,
  arrow: false,
  allowHTML: true,
  // interactive: true,
  offset: [0, 0],
  appendTo: document.body,
}

const Search: React.FC = () => {
  const [shown, setShown] = useState(false)

  useHotkeys('cmd+/', () => setShown(true))

  const [rtt, setRTT] = useState<number | undefined>(undefined)

  type Result = {
    owner: string
    repo: string
    commit: string
    path: string
    linetext: string
    lineno: number
    matches: any[]
  }

  const search = async (query: string) => {
    if (query === '') {
      return 'init'
    } else {
      const start = new Date().getTime()
      try {
        const res = await browser.runtime.sendMessage({
          kind: 'serverCall',
          args: { kind: 'query', ...determineCommit(), query },
        })

        setRTT(new Date().getTime() - start)
        return res
      } catch (e) {
        if ('message' in e && e.message === 'not-ready') return 'not-ready'
        else throw e
      }
    }
  }
  const [onKeyDown, results]: [(arg: string | undefined) => void, Result[] | 'not-ready' | 'init'] = useEventCallback(
    events =>
      events.pipe(
        scan((query0, query) => query ?? query0, undefined),
        debounceTime(500),
        filterDefined,
        switchMap(value => search(value))
      ),
    'init'
  )

  const groupResults = (
    rs: Result[]
  ): { [orcp: string]: { owner: string; repo: string; commit: string; path: string; results: Result[][] } } => {
    const ret: {
      [orcp: string]: { owner: string; repo: string; commit: string; path: string; l: number; results: Result[][] }
    } = {}
    for (const r of orderBy(rs, result => result.lineno)) {
      const orcp = `${r.owner}/${r.repo}/${r.commit}/${r.path}`
      const blurgh = ret[orcp] ?? { ...r, l: undefined, results: [] }
      ret[orcp] = blurgh
      if (blurgh.l !== undefined && r.lineno === blurgh.l + 1) {
        blurgh.results[blurgh.results.length - 1].push(r)
      } else {
        blurgh.results.push([r])
      }
      blurgh.l = r.lineno
    }
    return ret
  }

  return (
    <Dialog open={shown} onClose={() => setShown(false)} maxWidth={false}>
      <DialogTitle>Quick search</DialogTitle>
      <DialogContent style={{ display: 'flex', flexDirection: 'column', width: '900px', height: '80vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
            <SearchIcon />
            <Input
              autoFocus
              style={{ width: '600px' }}
              placeholder="Search..."
              onChange={e => onKeyDown(e.target.value)}
              onKeyDown={() => onKeyDown(undefined)}
            />
          </div>
          {rtt && <div>({rtt} ms)</div>}
        </div>
        {results === 'init' ? (
          /* reuses GitHub's markdown-body */ <div className="markdown-body">
            <ReactMarkdown source={initSearchHelp} />
          </div>
        ) : results === 'not-ready' ? (
          /* reuses GitHub's markdown-body */ <div className="markdown-body">
            <ReactMarkdown source={notReadySearchHelp} />
          </div>
        ) : results.length === 0 ? (
          /* reuses GitHub's markdown-body */ <div className="markdown-body">
            <ReactMarkdown source={`No matches found.`} />
          </div>
        ) : (
          <div
            style={{
              whiteSpace: 'pre',
              fontFamily: 'menlo, monospace',
              fontSize: '12px',
              width: '100%',
              tableLayout: 'fixed',
              overflow: 'auto',
            }}
            className="codewyng-search-results"
          >
            {entries(groupResults(results)).map(([orcp, path]) => (
              <div key={orcp} className="codewyng-file">
                <div className="codewyng-file-header">
                  <a
                    href={`https://github.com/${path.owner}/${path.repo}/blob/${'master'}/${path.path}`}
                    style={{
                      paddingLeft: '5px',
                    }}
                  >
                    {path.path}
                  </a>
                </div>
                {path.results.map((hunkrs, hunki) => (
                  <div key={hunki} className="codewyng-hunk">
                    {hunkrs.map(result => (
                      <a
                        key={`${result.owner}/${result.repo}/${result.path}/${result.lineno}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                        }}
                        href={`https://github.com/${result.owner}/${result.repo}/blob/${result.commit}/${
                          result.path
                        }#L${result.lineno + 1}`}
                        className="codewyng-result"
                      >
                        <div style={{ display: 'flex', overflow: 'hidden' }}>
                          <div
                            style={{
                              minWidth: '40px',
                              textAlign: 'right',
                              paddingRight: '5px',
                              backgroundColor: '#eee',
                              color: 'gray',
                            }}
                          >
                            {result.lineno}
                          </div>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <Highlighter
                              style={{ whiteSpace: 'pre', fontFamily: 'menlo, monospace', fontSize: '12px' }}
                              highlightClassName="codewyng-highlight"
                              textToHighlight={result.linetext}
                              searchWords={[]}
                              findChunks={() =>
                                result.matches.map(([offset, length]) => ({
                                  start: offset,
                                  end: offset + length,
                                }))
                              }
                            />
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

const initSearchHelp = `
🔍 Type a search query then hit **Enter**.

Searches file contents in the current repository for exact punctuation-aware matches.

Examples:

- \`foo.get(\`
- \`x = new X()\`

Results will show up here 👇.
`

const notReadySearchHelp = `
🕊 CodeWyng.io is cloning/fetching this commit as fast as it can!

Try running your search again in a few seconds.
`

const openInNewTab = (range: RepoCommitPathRange): void => {
  window.open(
    `https://github.com/${range.owner}/${range.repo}/blob/${range.commit}/${range.path}#L${range.line + 1}`,
    '_newtab'
  )
}

const onDiffView = (commitSpec: CommitSpec, repo: Repo) => {
  // tslint:disable-next-line: no-floating-promises
  touch({ ...repo, commit: commitSpec.base, ref: commitSpec.ref })
  // tslint:disable-next-line: no-floating-promises
  touch({ ...repo, commit: commitSpec.head, ref: commitSpec.ref })

  const elDiffView = $1('.diff-view')
  if (!elDiffView) {
    console.warn('expected a .diff-view to be present')
    return EMPTY
  }

  const observeJsFilesUnder = (
    root: HTMLElement,
    onJsFile: (jsFile: HTMLElement) => Unsubscribable
  ): Subscribable<never> =>
    observeNewChildren(root).pipe(
      mergeMap(
        el =>
          new Observable(_subscriber => {
            const elTeardown = new Subscription()
            if (el.classList.contains('js-file')) elTeardown.add(onJsFile(el))
            if (el.classList.contains('js-diff-progressive-container'))
              elTeardown.add(observeJsFilesUnder(el, onJsFile).subscribe())
            return elTeardown
          })
      ),
      ignoreElements()
    )

  const path2Anchor = new Map<string, string>()
  const j2d = (range: RepoCommitPathRange) => {
    const anchor = path2Anchor.get(stringify(_.pick(range, 'owner', 'repo', 'path')))
    if (!anchor) return openInNewTab(range)
    const lineNum = findCommitLineNum(anchor, commitSpec, range.commit, range.line)
    const blobCode = lineNum?.parentElement?.querySelector<HTMLElement>('.blob-code')
    if (!lineNum || !blobCode) return openInNewTab(range)
    senpai(lineNum, blobCode, 'center')
  }

  return observeJsFilesUnder(elDiffView, elJsFile => {
    // tslint:disable-next-line: prefer-const
    let [basePath, headPath] =
      elJsFile.querySelector('.js-file-header clipboard-copy')?.getAttribute('value')?.split(' → ') ?? []
    if (basePath === undefined) return new Subscription()
    if (headPath === undefined) headPath = basePath

    const loaded = elJsFile.querySelector('.js-blob-wrapper>.js-diff-table')
    const willload = elJsFile.querySelector('.js-diff-load-container')
    return concat(
      !loaded ? EMPTY : of(loaded as HTMLElement),
      !willload
        ? EMPTY
        : observeNewChildren(willload).pipe(
            filter(element => element.classList.contains('js-blob-wrapper')),
            concatMap(element => {
              const jsDiffTable = element.querySelector('.js-diff-table')
              return jsDiffTable ? of(jsDiffTable as HTMLElement) : EMPTY
            })
          )
    )
      .pipe(
        tap(jsDiffTable => {
          const anchor = jsDiffTable.getAttribute('data-diff-anchor')
          if (!anchor) return
          path2Anchor.set(stringify(_.pick({ ...repo, path: basePath }, 'owner', 'repo', 'path')), anchor)
          path2Anchor.set(stringify(_.pick({ ...repo, path: headPath }, 'owner', 'repo', 'path')), anchor)
        }),
        switchMap(jsDiffTable =>
          onDiff(jsDiffTable, { ...repo, path: basePath }, { ...repo, path: headPath }, commitSpec, j2d)
        )
      )
      .subscribe()
  })
}

const touch = async (args: RepoCommit & { ref?: string }): Promise<void> =>
  await browser.runtime.sendMessage({
    kind: 'touch',
    args,
  })

type CommitSpec = { base: string; head: string; ref?: string }
const determinePRFilesCommitSpec = (prNumberAsString: string): CommitSpec => {
  const focus = $1('.toc-select details-menu')
  if (focus) {
    const dataUrl = focus.getAttribute('src')
    if (dataUrl === null) throw new Error('determinePRFilesCommitSpec: expected src')
    const url = new URL('https://placeholder.com' + dataUrl)
    const base = url.searchParams.get('sha1')
    const end = url.searchParams.get('sha2')
    if (base === null || end === null) throw new Error('determinePRFilesCommitSpec: expected sha1 and sha2')
    return { base, head: end, ref: `refs/pull/${prNumberAsString}/head` }
  }
  throw new Error('determinePRFilesCommitSpec: expected either commit or PR')
}

const determineCommitSpec = (): CommitSpec => {
  const focus = $1('.sha-block>span.sha')
  if (focus) {
    const current = focus.textContent
    if (current === null || current.length !== 40) throw new Error('determineCommitSpec: expected current 40 char sha')
    const parent = $1('.sha-block>a')
    if (!parent) return { base: '0'.repeat(40), head: current }
    const href = parent.getAttribute('href')
    if (!href) throw new Error('determineCommitSpec: expected parent href')
    const components = href.split('/')
    if (components.length === 0) throw new Error('determineCommitSpec: expected parent href components')
    const sha = components[components.length - 1]
    if (sha.length !== 40) throw new Error('determineCommitSpec: expected parent href components 40 char sha')
    return { base: sha, head: current }
  }
  throw new Error('determineCommitSpec: expected either commit or PR')
}

type Repo = { owner: string; repo: string }
type RepoCommit = Repo & { commit: string }
type RepoPath = Repo & { path: string }
type RepoCommitPath = Repo & { commit: string } & { path: string }
type RepoCommitPathMRef = Repo & { commit: string } & { path: string } & { ref?: string }
type RepoCommitPathRange = Repo & { commit: string } & { path: string } & Range
type RepoCommitPathRangeMRef = Repo & { commit: string } & { path: string } & Range & { ref?: string }

const findCommitLineNum = (
  diffAnchor: string,
  commitSpec: CommitSpec,
  commit: string,
  line: number
): HTMLElement | undefined => {
  const side = commit === commitSpec.base ? 'L' : 'R'
  return $1(`#${diffAnchor}${side}${line + 1}`)
}

const range2Symbol = (
  symbolAt: (range: RepoCommitPathRangeMRef) => Promise<Sym | undefined>
): OperatorFunction<
  RepoCommitPathRangeMRef | undefined,
  { sym: Sym | undefined; range: RepoCommitPathRange } | undefined
> =>
  concatMap(async range => {
    if (!range) return undefined
    try {
      return { sym: await symbolAt(range), range }
    } catch (e) {
      if (e.message === 'not-ready')
        return { sym: { hover: 'CodeWyng is still processing...', references: [range] }, range }
      else throw e
    }
  })

const observeIntersection = (
  target: Element,
  options: IntersectionObserverInit
): Observable<IntersectionObserverEntry> =>
  new Observable(subscriber => {
    const observer = new IntersectionObserver(ientries => ientries.forEach(entry => subscriber.next(entry)), options)
    observer.observe(target)
    return () => observer.disconnect()
  })

const applyUnderline = (underline: boolean, el: HTMLElement | undefined, range: Range) => {
  if (!el) return
  for (const piece of selectRange(el, range.characterStart, range.characterEnd)) {
    if (underline) piece.classList.add('codewyng-highlightable')
    else piece.classList.remove('codewyng-highlightable')
  }
}

const onDiff = (
  jsDiffTable: HTMLElement,
  basePath: RepoPath,
  headPath: RepoPath,
  commitSpec: CommitSpec,
  j2d: (range: RepoCommitPathRange) => void
): Observable<never> =>
  observeIntersection(jsDiffTable, { rootMargin: '200px' }).pipe(
    filter(entry => entry.isIntersecting),
    take(1),
    switchMap(() =>
      from(
        Promise.all([
          fetchStencil({ ...basePath, commit: commitSpec.base, ref: commitSpec.ref }),
          fetchStencil({ ...headPath, commit: commitSpec.head, ref: commitSpec.ref }),
        ])
      )
    ),
    switchMap(
      ([baseStencil, headStencil]): Observable<never> => {
        const { symbolAt } = mkSymbolAt()
        const diffAnchor = jsDiffTable.getAttribute('data-diff-anchor')
        if (!diffAnchor) return EMPTY
        const pos2Range: OperatorFunction<PositionWithKind | undefined, RepoCommitPathRange | undefined> = observable =>
          observable.pipe(
            concatMap(async pos => {
              if (!pos) return undefined
              const inject = async (stencil: Stencil, commit: string, repoPath: RepoPath) => {
                const range = stencil.find(contains(pos))
                if (!range) return undefined
                return { ...repoPath, commit, ...range }
              }
              switch (pos.kind) {
                case 'addition':
                  return await inject(headStencil, commitSpec.head, headPath)
                case 'deletion':
                  return await inject(baseStencil, commitSpec.base, basePath)
                case 'context':
                  return await inject(baseStencil, commitSpec.base, basePath)
                case 'normal':
                  return await inject(baseStencil, commitSpec.base, basePath)
                default:
                  throw new Error('onDiff: unexpected kind')
              }
            }),
            unique()
          )

        const findBlobCodeInner = (range: RepoCommitPathRange): HTMLElement | undefined => {
          return (
            findCommitLineNum(diffAnchor, commitSpec, range.commit, range.line)?.parentElement?.querySelector(
              '.blob-code-inner'
            ) ?? undefined
          )
        }

        // TODO factor this out and reuse it for blob/blame views
        return merge(
          fromEvent(jsDiffTable, 'mousemove').pipe(
            debounceTime(80),
            positions(),
            pos2Range,
            map(range => range && { ...range, ref: commitSpec.ref }),
            range2Symbol(symbolAt),
            switchMap(showTippy(findBlobCodeInner, j2d)),
            ignoreElements()
          ),
          observeUnderlineVariables.pipe(
            tap(underline => {
              for (const range of headStencil)
                applyUnderline(underline, findBlobCodeInner({ ...headPath, commit: commitSpec.head, ...range }), range)
              for (const range of baseStencil)
                applyUnderline(underline, findBlobCodeInner({ ...basePath, commit: commitSpec.base, ...range }), range)
            }),
            ignoreElements()
          )
        )
      }
    )
  )

;(window as any).tippy = tippy

const observeMutations = (target: Node, options?: MutationObserverInit): Observable<MutationRecord[]> =>
  new Observable(subscriber => {
    const mutationObserver = new MutationObserver(mutationRecords => subscriber.next(mutationRecords))
    mutationObserver.observe(target, options)
    return () => mutationObserver.disconnect()
  })

const observeNewChildren = (target: Node): Observable<HTMLElement> => {
  const isHTMLElement = (node: Node): node is HTMLElement => node instanceof HTMLElement
  return concat(
    from(Array.from(target.childNodes).flatMap(element => (element instanceof HTMLElement ? [element] : []))),
    observeMutations(target, { childList: true }).pipe(
      concatMap(mutationRecords =>
        from(mutationRecords.flatMap(mutationRecord => Array.from(mutationRecord.addedNodes).filter(isHTMLElement)))
      )
    )
  )
}

const onBlobOrBlame = (pathComponents: string[], repo: Repo): Subscribable<never> => {
  disableGitHubNative()

  const [rev, ...pathPieces] = pathComponents
  const path = pathPieces.join('/')
  const ref = rev.length === 40 && /^[0-9a-f]+$/.test(rev) ? undefined : `refs/heads/${rev}`
  const { commit } = determineFile()

  const jsFileLineContainer = $1('.js-file-line-container')
  if (!jsFileLineContainer) {
    console.log(`could not find .js-file-line-container TODO figure out why this happens`)
    return EMPTY
  }

  // TODO see if you can make one of these and/or add it to a Subscription
  const { symbolAt } = mkSymbolAt()

  const j2d = (range: RepoCommitPathRange) => {
    if (!isEqual({ ...repo, commit, path }, _.pick(range, ['owner', 'repo', 'commit', 'path'])))
      return openInNewTab(range)
    const lineNum = $1(`[data-line-number="${range.line + 1}"]`) ?? $1(`#L${range.line + 1}`)
    const blobCode = lineNum?.parentElement?.querySelector<HTMLElement>('.blob-code')
    if (!lineNum || !blobCode) return openInNewTab(range)
    senpai(lineNum, blobCode, 'nearest')
  }

  return from(fetchStencil({ ...repo, commit, path, ref })).pipe(
    catchError(() => of(undefined)),
    switchMap(stencil => {
      if (!stencil) return EMPTY
      return new Observable<never>(subscriber => {
        const pos2Range: OperatorFunction<PositionWithKind | undefined, RepoCommitPathRange | undefined> = observable =>
          observable.pipe(
            concatMap(async pos => {
              if (!pos) return undefined
              const range = stencil.find(contains(pos))
              return range && { ...repo, path, commit, ...range }
            }),
            unique()
          )

        const findBlobCodeInner = (range: RepoCommitPathRange): HTMLElement | undefined => {
          return (
            $1(`[data-line-number="${range.line + 1}"]`)?.parentElement?.querySelector<HTMLElement>(
              '.blob-code-inner'
            ) ??
            $1(`#LC${range.line + 1}`) ??
            undefined
          )
        }

        return merge(
          observeUnderlineVariables.pipe(
            tap(underline => {
              for (const range of stencil)
                applyUnderline(underline, findBlobCodeInner({ ...repo, path, commit, ...range }), range)
            })
          ),
          fromEvent(jsFileLineContainer, 'mousemove').pipe(
            debounceTime(80),
            positions(),
            pos2Range,
            map(range => range && { ...range, ref }),
            range2Symbol(symbolAt),
            switchMap(showTippy(findBlobCodeInner, j2d))
          )
        )
          .pipe(ignoreElements())
          .subscribe(subscriber)
      })
    })
  )
}

const showTippy = (
  findBlobCodeInner: (range: RepoCommitPathRange) => HTMLElement | undefined,
  j2d: (range: RepoCommitPathRange) => void
) => (sym: { sym: Sym; range: RepoCommitPathRange } | undefined): Subscribable<never> => {
  if (!sym) return EMPTY

  const currentBlobCodeInner = findBlobCodeInner(sym.range)
  if (!currentBlobCodeInner || !(currentBlobCodeInner instanceof HTMLElement)) {
    console.warn('showTippy: expected blobCodeInner')
    return EMPTY
  }

  const pickRepoCommitPathRange = (range: RepoCommitPathRange): RepoCommitPathRange =>
    _.pick(range, ['owner', 'repo', 'commit', 'path', 'line', 'characterStart', 'characterEnd'])

  const isDefinition = sym.sym.definition
    ? isEqual(pickRepoCommitPathRange(sym.range), pickRepoCommitPathRange(sym.sym.definition))
    : false
  const hover = isDefinition
    ? sym.sym.hover ?? 'Defined here.'
    : _.compact([
        sym.sym.hover,
        sym.sym.definition &&
          (sym.sym.definition.path === sym.range.path
            ? `Defined on line ${sym.sym.definition.line + 1}`
            : `Defined in ${sym.sym.definition?.path}`),
      ]).join('\n\n---\n\n')
  return new Observable(_subscriber => {
    const s = new Subscription()
    // TODO calling tippy() on multiple elements shows multiple tippys. Should only show 1.
    const hoverPieces = selectRange(currentBlobCodeInner, sym.range.characterStart, sym.range.characterEnd)
    const allPieces = symbolRanges(sym.sym).flatMap(range => {
      if (range.path !== sym.range.path) return []
      const x = findBlobCodeInner(range)
      if (!x) return []
      return selectRange(x, range.characterStart, range.characterEnd)
    })
    const ts = tippy(hoverPieces, {
      ...tippystyleprops,
      showOnCreate: true,
      onShow: () => allPieces.forEach(piece => piece.classList.add('codewyng-highlighted')),
      onHide: () => allPieces.forEach(piece => piece.classList.remove('codewyng-highlighted')),
      onDestroy: () => allPieces.forEach(piece => piece.classList.remove('codewyng-highlighted')),
      content: `<div style="overflow: hidden;">${md.render(hover)}</div>`,
    })
    s.add(() => ts.forEach(t => t.destroy()))
    const def = sym.sym.definition
    if (def && !isDefinition) {
      const onClick = () => j2d(def)
      hoverPieces.forEach(piece => {
        piece.classList.add('codewyng-clickable')
        piece.addEventListener('click', onClick)
        s.add(() => {
          piece.removeEventListener('click', onClick)
          piece.classList.remove('codewyng-clickable')
        })
      })
    }

    return s
  })
}

const onPRPage = (pathComponents: string[], repo: Repo): Subscribable<never> => {
  const [prNumberAsString, prPageKind, ...prComponents] = pathComponents

  switch (prPageKind) {
    case 'files':
    case 'commits':
      return onDiffView(determinePRFilesCommitSpec(prNumberAsString), repo)
    default:
      return EMPTY
  }
}

const powerOn = (): Subscribable<never> => {
  const [_beforeFirstSlash, owner, repo, pageKind, ...pathComponents] = window.location.pathname.split('/')
  switch (pageKind) {
    case 'blob':
    case 'blame':
      return onBlobOrBlame(pathComponents, { owner, repo })
    case 'pull':
      return onPRPage(pathComponents, { owner, repo })
    case 'commit':
      return onDiffView(determineCommitSpec(), { owner, repo })
    default:
      return EMPTY
  }
}

export async function main(): Promise<void> {
  if (!isPublic()) {
    return
  }

  if ($1('.repohead')) {
    const div = document.createElement('div')
    document.body.appendChild(div)
    ReactDOM.render(<Search />, div)
    try {
      // tslint:disable-next-line: no-floating-promises
      touch(determineCommit())
    } catch (e) {}
  }

  initCSS()

  // CodeWyng is either on or off
  type OnOff = 'on' | 'off'
  const on: OnOff = 'on'
  const off: OnOff = 'off'

  // Merge on/off signals and call powerOn() when turned on
  merge<OnOff>(
    new Observable(subscriber => {
      $(document).ready(() => {
        subscriber.next(on)
        subscriber.complete()
      })
    }),
    fromEvent(document, 'pjax:start').pipe(mapTo(off)),
    fromEvent(document, 'pjax:end').pipe(mapTo(on))
  )
    .pipe(switchMap(onOff => (onOff === on ? powerOn() : EMPTY)))
    .subscribe()
}

// tslint:disable-next-line: no-floating-promises
main()
