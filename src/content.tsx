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
      } catch (e) {}
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
    x += characterWidth * (text[i] === '\t' ? tabSize : 1)
    if (x > contentX) {
      return i
    }
  }
  return undefined
}

type PositionWithKind = Position & { kind: LineSpec['kind'] }

function positions(): OperatorFunction<MouseEvent, PositionWithKind | undefined> {
  const constants = once(a => {
    const { paddingLeft, font } = window.getComputedStyle(a, null)
    return {
      paddingLeft: parseFloat(paddingLeft),
      characterWidth: textWidth('x', font),
      tabSize: parseInt(a.closest('table').getAttribute('data-tab-size')),
    }
  })

  function computePosition(event: MouseEvent): PositionWithKind | undefined {
    const blobCodeInner = (event.target as HTMLElement).closest<HTMLElement>('.blob-code-inner')
    if (!blobCodeInner) {
      // Cursor is nowhere in the file
      return
    }
    const firstEl = blobCodeInner.children[0]
    if (!firstEl) {
      // No text on this line
      return
    }

    const { characterWidth, tabSize } = constants(blobCodeInner)
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
  spannify2(blobCodeInner)
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
  if (!tr) return

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

function applySymbol(file: RepoCommitPath, arg: { sym: Sym | undefined; range: Range } | undefined): void {
  $n('.codewyng-highlighted').forEach(e => e.classList.remove('codewyng-highlighted'))
  currentTippys.forEach(t => t.destroy())
  currentTippys = []
  if (!arg || !arg.sym) return

  const { sym, range: hoveredRange } = arg

  const ranges = symbolRanges(sym).filter(range => range.path === file.path)
  if (ranges.length > 1000) {
    console.warn(`too many ranges to highlight (${ranges.length})`)
    return
  }

  const hoveredTippys: Instance[] = []
  for (const range of ranges) {
    const jsFileLine = $1(`[data-line-number="${range.line + 1}"]`)?.nextElementSibling as HTMLElement | undefined
    if (!jsFileLine) continue

    const isDefinition = isEqual(range, sym.definition)
    const hover = isDefinition
      ? 'Click to find references.'
      : _.compact([
          sym.hover,
          sym.definition &&
            (sym.definition.path === file.path
              ? `Defined on line ${sym.definition.line + 1}`
              : `Defined in ${sym.definition?.path}`),
        ]).join('\n\n---\n\n')

    const pieces = selectRange(jsFileLine, range.characterStart, range.characterEnd)
    const to = tippy(pieces, {
      ...tippystyleprops,
      content: `<div style="overflow: hidden;">${md.render(hover)}</div>`,
    } as any)
    currentTippys.push(...to)

    if (isEqual(_.pick(range, ['line', 'characterStart', 'characterEnd']), hoveredRange)) {
      for (const piece of pieces) piece.classList.add('codewyng-highlighted')
      hoveredTippys.push(...to)
    }
  }

  hoveredTippys.forEach(t => t.show())
}

function initCSS() {
  const style = document.createElement('style')
  document.head.appendChild(style)
  const sheet = style.sheet as CSSStyleSheet
  sheet.insertRule('.senpai { background-color: rgba(255, 179, 109, 0.5) !important }')
  sheet.insertRule('.senpai2 { background-color: white; transition: background-color 2000ms linear !important }')
  sheet.insertRule('.codewyng-clickable { cursor: pointer }')
  // sheet.insertRule(`.codewyng-highlightable {
  //   text-decoration: underline;
  //   text-decoration-style: dashed;
  //   text-decoration-color: gray;
  // }`)

  // !important so it shows up even on word diffs.
  sheet.insertRule('.codewyng-highlighted { background-color: rgba(255, 179, 109, 0.5) !important }')
  sheet.insertRule('.refpanel:hover { background-color: white }')
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

const senpai = (line: HTMLElement) => {
  line.classList.add('senpai')
  line.scrollIntoView({
    behavior: 'smooth', // auto/smooth
    block: 'nearest',
  })
  const intersectionObserver = new IntersectionObserver(isectentries => {
    const [entry] = isectentries
    if (entry.isIntersecting) {
      line.classList.add('senpai2')
      line.classList.remove('senpai')
      setTimeout(() => {
        line.classList.remove('senpai2')
      }, 2000)
    }
  })
  // start observing
  intersectionObserver.observe(line)
}

let refpanel: { symbol: Sym; el: HTMLElement } | undefined

const dismissRefpanel = () => {
  if (refpanel) {
    refpanel.el.remove()
    refpanel = undefined
  }
}

const showRefPanel = (lines: HTMLElement[], symbol: Sym, e: MouseEvent) => {
  const oldSymbol = refpanel?.symbol
  dismissRefpanel()
  if (isEqual(oldSymbol, symbol)) {
    return
  }

  const target = e.target as HTMLElement
  // target
  //   .closest('tr')
  //   .insertAdjacentHTML(
  //     'afterend',
  //     '<tr><td colspan="2"><div style="height: 100px; background-color: khaki;"></div></td></tr>'
  //   )
  const tr = target.closest('tr')
  if (!tr) throw new Error('no tr for target')
  const div = document.createElement('div')
  div.style.maxHeight = '200px'
  div.style.overflow = 'auto'
  div.style.backgroundColor = '#fafbfc'

  div.style.boxSizing = 'border-box'
  div.style.borderTop = 'rgba(0,0,0,0.5) solid 1px'
  div.style.borderBottom = 'rgba(0,0,0,0.5) solid 1px'
  const label = document.createElement('div')
  label.style.color = 'gray'
  label.appendChild(document.createTextNode(`${symbol.references.length} References`))
  label.style.borderBottom = 'rgba(0,0,0,0.5) solid 1px'
  div.append(label)
  const table = document.createElement('table')
  table.style.width = '100%'
  div.append(table)
  table.append(
    ...symbol.references.map(r => {
      const lineTr = lines[r.line].closest('tr')
      if (!lineTr) throw new Error(`line ${r.line} has no ancestor <tr>`)
      const reftr = lineTr.cloneNode(true) as HTMLElement
      reftr.style.cursor = 'pointer'
      reftr.addEventListener('click', refClickEvent => {
        senpai(lineTr)
      })
      reftr.querySelectorAll('span').forEach(span => {
        span.classList.remove('codewyng-clickable')
        // span.classList.remove('codewyng')
      })
      // this will probably get cleaned up while working more on the ref panel
      reftr.querySelector('td:nth-child(2)')!.classList.add('refpanel')
      return reftr
    })
  )
  const td = document.createElement('td')
  td.setAttribute('colspan', '2')
  td.appendChild(div)
  const panel = document.createElement('tr')
  panel.appendChild(td)
  if (tr.nextElementSibling === null) {
    tr.parentElement!.append(panel)
  } else {
    tr.parentElement!.insertBefore(panel, tr.nextElementSibling)
  }
  refpanel = { symbol, el: td }
}

function setUpClickHandler(
  file: RepoCommitPath,
  piece: HTMLElement,
  symbol: Sym,
  kind: 'definition' | 'reference'
): void {
  // piece.style.backgroundColor = 'yellow'
  piece.classList.add('codewyng-clickable')
  const lines = $n('.js-file-line:not(.refpanel)')
  piece.addEventListener('click', e => {
    switch (kind) {
      case 'definition':
        showRefPanel(lines, symbol, e)
        break
      case 'reference':
        if (!symbol.definition) {
          showRefPanel(lines, symbol, e)
        } else {
          // j2d

          // IF SETTINGS.USEPUSHTATE
          // const curline =
          //   parseInt(
          //     (e.target as HTMLElement)
          //       .closest('.blob-code')
          //       .parentElement.querySelector('.blob-num')
          //       .getAttribute('data-line-number')
          //   ) - 1
          // window.history.pushState(null, null, '#L' + (curline + 1))
          // window.history.pushState(null, null, '#L' + symbol.definition.line)

          if (symbol.definition.path !== file.path) {
            const d = symbol.definition
            // CROSS-FILE
            const destination = `https://github.com/${d.owner}/${d.repo}/blob/${d.commit}/${d.path}#L${d.line + 1}`
            if (e.metaKey || e.ctrlKey) {
              window.open(destination, '_newtab')
            } else {
              window.location.href = destination
            }
            return
          } else {
            // SAME-FILE
            const destination = new URL(window.location.href)
            destination.hash = `#L${symbol.definition.line + 1}`
            if (e.metaKey || e.ctrlKey) {
              window.open(destination.href, '_newtab')
            } else {
              const line = lines[symbol.definition.line]
              senpai(line.closest('tr')!)
            }
          }
        }
        break
      default:
        throw new Error('impossible')
    }
  })
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
const determineCommit = (): { owner: string; repo: string; commit: string } => {
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
  return { owner, repo, commit }
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

const fetchStencil = async (repoCommitPath: RepoCommitPath): Promise<Stencil> =>
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
        ..._.pick(range, ['owner', 'repo', 'commit', 'path', 'line']),
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

const findRange = (ranges: Range[]) => (position: Position): Range | undefined =>
  ranges.find(range => contains(position)(range))

function onSymbol(file: RepoCommitPath, symbol: Sym): void {
  const lines = $n('.js-file-line:not(.refpanel)')

  // spannify
  const iscrossfiledef = (s: Sym) => s.definition?.path !== file.path
  uniq<number>([
    ...(symbol.definition && !iscrossfiledef(symbol) ? [symbol.definition.line] : []),
    ...symbol.references.map(reference => reference.line),
  ]).forEach(spannify)

  function applydef(definition: Range): void {
    for (const piece of selectRange(lines[definition.line], definition.characterStart, definition.characterEnd)) {
      setUpClickHandler(file, piece, symbol, 'definition')
    }
  }

  function applyref(references: Range[]): void {
    for (const reference of references) {
      for (const piece of selectRange(lines[reference.line], reference.characterStart, reference.characterEnd)) {
        setUpClickHandler(file, piece, symbol, 'reference')
      }
    }
  }

  if (symbol.definition && !iscrossfiledef(symbol)) applydef(symbol.definition)
  applyref(symbol.references)
}

const spannified = new Set()

function spannify(line: number): void {
  if (spannified.has(line)) {
    return
  }
  for (const child of Array.from($n('.js-file-line:not(.refpanel)')[line].childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const span = document.createElement('span')
      span.appendChild(document.createTextNode(textContent(child)))
      child.parentElement!.replaceChild(span, child)
    }
  }
  spannified.add(line)
}

function spannify2(blobCodeInner: HTMLElement): void {
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
  const octolyticspublic =
    document
      .querySelector('head > meta[name="octolytics-dimension-repository_public"]')
      ?.getAttribute('octolytics-dimension-repository_public') === 'true'
  const publicclass = Boolean($1('.public'))

  return octolyticspublic || publicclass
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
  distance: 0,
  appendTo: document.body,
}

const Search: React.FC = () => {
  const [shown, setShown] = useState(false)
  const [rtt, setRTT] = useState<number | undefined>(undefined)
  const [query, setQuery] = useState('')
  type Result = {
    owner: string
    repo: string
    commit: string
    path: string
    linetext: string
    lineno: number
    matches: any[]
  }
  const [results, setResults] = useState<Result[] | 'not-ready' | 'init'>('init')
  useHotkeys('cmd+/', () => setShown(true))
  const search = async () => {
    if (query === '') {
      setResults('init')
    } else {
      const start = new Date().getTime()
      setResults(
        await browser.runtime.sendMessage({
          kind: 'serverCall',
          args: { kind: 'query', ...determineCommit(), query },
        })
      )
      setRTT(new Date().getTime() - start)
    }
  }

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
      <DialogContent style={{ display: 'flex', flexDirection: 'column', width: '900px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
            <SearchIcon />
            <Input
              autoFocus
              style={{ width: '600px' }}
              placeholder="Search..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter') {
                  await search()
                }
              }}
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

const oldOnBlobPage = async () => {
  const selector = '.js-file-line-container'
  const fileContainer = $1(selector)
  if (!fileContainer) {
    console.log(`could not find ${selector} at ${window.location} TODO figure out why this happens`)
    return
  }

  const file = determineFile()

  let stencil: Stencil | undefined
  try {
    stencil = await fetchStencil(determineFile())
  } catch (e) {
    if (e.message === 'unsupported-language') {
      console.log('unsupported language')
      return
    } else {
      throw e
    }
  }

  const { symbolAt, symbols } = mkSymbolAt()

  symbols.subscribe(sym => onSymbol(file, sym))

  merge(fromEvent(fileContainer, 'mousemove').pipe(debounceTime(80), positions(), map(bind(findRange(stencil)))))
    .pipe(
      uniqueBy(arg => arg),
      switchMap(async range => {
        if (!range) return undefined
        try {
          return { sym: await symbolAt({ ...file, ...range }), range }
        } catch (e) {
          if (e.message === 'not-ready')
            return { sym: { hover: 'CodeWyng is still processing...', references: [{ ...file, ...range }] }, range }
          else throw e
        }
      })
    )
    .subscribe(sym => applySymbol(file, sym))

  fromEvent(fileContainer, 'click')
    .pipe(
      positions(),
      filter(x => x === undefined)
    )
    .subscribe(() => {
      dismissRefpanel()
    })

  disableGitHubNative()
}

const touch = async (commit: RepoCommit): Promise<void> =>
  await browser.runtime.sendMessage({
    kind: 'touch',
    args: commit,
  })

const onRepoPage = async () => {
  const div = document.createElement('div')
  $1('.blob-wrapper')?.parentElement?.prepend(div)
  ReactDOM.render(<Search />, div)
  let commit: { owner: string; repo: string; commit: string } | undefined
  try {
    commit = determineCommit()
  } catch (e) {}
  if (commit) {
    // tslint:disable-next-line: no-floating-promises
    touch(commit)
  }
}

type CommitSpec = { base: string; head: string }
const determineCommitSpec = (): CommitSpec => {
  let focus = $1('.sha-block>span.sha')
  if (focus) {
    const current = focus.textContent
    if (current === null || current.length !== 40) throw new Error('onDiff: expected current 40 char sha')
    const parent = $1('.sha-block>a')
    if (!parent) return { base: '0'.repeat(40), head: current }
    const href = parent.getAttribute('href')
    if (!href) throw new Error('onDiff: expected parent href')
    const components = href.split('/')
    if (components.length === 0) throw new Error('onDiff: expected parent href components')
    const sha = components[components.length - 1]
    if (sha.length !== 40) throw new Error('onDiff: expected parent href components 40 char sha')
    return { base: sha, head: current }
  }
  focus = $1('.js-pull-refresh-on-pjax')
  if (focus) {
    const dataUrl = focus.getAttribute('data-url')
    if (dataUrl === null) throw new Error('onDiff: expected data-url')
    const url = new URL('https://placeholder.com' + dataUrl)
    const base = url.searchParams.get('base_commit_oid')
    const end = url.searchParams.get('end_commit_oid')
    if (base === null || end === null) throw new Error('onDiff: expected base and end')
    return { base, head: end }
  }
  throw new Error('onDiff: expected either commit or PR')
}

type Repo = { owner: string; repo: string }
type RepoCommit = Repo & { commit: string }
type RepoPath = Repo & { path: string }
type RepoCommitPath = Repo & { commit: string } & { path: string }
type RepoCommitPathPosition = Repo & { commit: string } & { path: string } & Position
type RepoCommitPathRange = Repo & { commit: string } & { path: string } & Range

const onDiff = (jsDiffTable: HTMLElement, repoPath: RepoPath, commitSpec: CommitSpec): Subscribable<never> =>
  new Observable(subscriber => {
    const getBaseStencil = _.once(() => fetchStencil({ ...repoPath, commit: commitSpec.base }))
    const getHeadStencil = _.once(() => fetchStencil({ ...repoPath, commit: commitSpec.head }))
    const { symbolAt } = mkSymbolAt()
    const pos2Range: OperatorFunction<PositionWithKind | undefined, RepoCommitPathRange | undefined> = observable =>
      observable.pipe(
        concatMap(async pos => {
          if (!pos) return undefined
          const inject = async (stencil: Stencil, commit: string) => {
            const range = stencil.find(contains(pos))
            if (!range) return undefined
            return { ...repoPath, commit, ...range }
          }
          switch (pos.kind) {
            case 'addition':
              return await inject(await getHeadStencil(), commitSpec.head)
            case 'deletion':
              return await inject(await getBaseStencil(), commitSpec.base)
            case 'context':
              return await inject(await getBaseStencil(), commitSpec.base)
            case 'normal':
              return await inject(await getBaseStencil(), commitSpec.base)
            default:
              throw new Error('onDiff: unexpected kind')
          }
        }),
        unique()
      )

    const range2Symbol: OperatorFunction<
      RepoCommitPathRange | undefined,
      { sym: Sym | undefined; range: RepoCommitPathRange } | undefined
    > = concatMap(async range => {
      if (!range) return undefined
      try {
        return { sym: await symbolAt({ ...repoPath, ...range }), range }
      } catch (e) {
        if (e.message === 'not-ready')
          return { sym: { hover: 'CodeWyng is still processing...', references: [{ ...repoPath, ...range }] }, range }
        else throw e
      }
    })

    const showTippy = (sym: { sym: Sym; range: RepoCommitPathRange } | undefined): Subscribable<never> => {
      if (!sym) return EMPTY

      const commit2BlobNumSelector = (commit: string): string => {
        if (commit === commitSpec.base) {
          return '.blob-num:nth-child(1)'
        } else {
          return '.blob-num-addition'
        }
      }

      const findBlobCodeInner = (range: RepoCommitPathRange): HTMLElement | undefined => {
        return (
          jsDiffTable
            .querySelector(`${commit2BlobNumSelector(range.commit)}[data-line-number="${range.line + 1}"]`)
            ?.parentElement?.querySelector('.blob-code-inner') ?? undefined
        )
      }

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
              (sym.sym.definition.path === repoPath.path
                ? `Defined on line ${sym.sym.definition.line + 1}`
                : `Defined in ${sym.sym.definition?.path}`),
          ]).join('\n\n---\n\n')
      return new Observable(_subscriber => {
        const s = new Subscription()
        // TODO calling tippy() on multiple elements shows multiple tippys. Should only show 1.
        const hoverPieces = selectRange(currentBlobCodeInner, sym.range.characterStart, sym.range.characterEnd)
        const allPieces = symbolRanges(sym.sym).flatMap(range => {
          if (range.path !== repoPath.path) return []
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
          hoverPieces.forEach(piece => {
            piece.classList.add('codewyng-clickable')
            const listener = () => {
              const destination = `https://github.com/${def.owner}/${def.repo}/blob/${def.commit}/${def.path}#L${
                def.line + 1
              }`
              window.open(destination, '_newtab')
            }
            piece.addEventListener('click', listener)
            s.add(() => {
              piece.removeEventListener('click', listener)
              piece.classList.remove('codewyng-clickable')
            })
          })
        }

        return s
      })
    }

    return merge(
      fromEvent(jsDiffTable, 'mousemove').pipe(
        debounceTime(80),
        positions(),
        pos2Range,
        range2Symbol,
        switchMap(showTippy),
        ignoreElements()
      )
    ).subscribe(subscriber)
  })

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

const onBlobPage = (): Subscribable<never> => {
  // tslint:disable-next-line: no-floating-promises
  oldOnBlobPage()
  return EMPTY
}

const onPRPage = (pathComponents: string[], repo: Repo): Subscribable<never> => {
  const [_prNumberAsString, prPageKind, ...prComponents] = pathComponents
  switch (prPageKind) {
    case 'files':
      const elDiffView = $1('.diff-view')
      if (!elDiffView) {
        console.warn('expected a .diff-view to be present')
        return EMPTY
      }

      const observeJsFilesUnder = (
        root: HTMLElement,
        onJsFile: (jsFile: HTMLElement) => Unsubscribable
      ): Subscribable<never> =>
        new Observable(_subscriber => {
          observeNewChildren(root).subscribe(el => {
            const elTeardown = new Subscription()
            if (el.classList.contains('js-file')) elTeardown.add(onJsFile(el))
            if (el.classList.contains('js-diff-progressive-container'))
              elTeardown.add(observeJsFilesUnder(el, onJsFile).subscribe())
            return elTeardown
          })
        })

      const commitSpec = determineCommitSpec()
      // tslint:disable-next-line: no-floating-promises
      touch({ ...repo, commit: commitSpec.base })
      // tslint:disable-next-line: no-floating-promises
      touch({ ...repo, commit: commitSpec.head })

      return observeJsFilesUnder(elDiffView, elJsFile => {
        const path = elJsFile.querySelector('.js-file-header')?.getAttribute('data-path')
        if (path === undefined || path === null) return new Subscription()

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
          .pipe(switchMap(jsDiffTable => onDiff(jsDiffTable, { ...repo, path }, commitSpec)))
          .subscribe()
      })
    default:
      return EMPTY
  }
}

const powerOn = (): Subscribable<never> => {
  const [_beforeFirstSlash, owner, repo, pageKind, ...pathComponents] = window.location.pathname.split('/')
  switch (pageKind) {
    case 'blob':
      return onBlobPage()
    case 'pull':
      return onPRPage(pathComponents, { owner, repo })
    default:
      return EMPTY
  }
}

export async function main(): Promise<void> {
  if (!isPublic()) {
    return
  }

  if ($1('.repohead')) {
    await onRepoPage()
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
