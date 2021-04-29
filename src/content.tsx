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
  mergeMap,
  concatMap,
  ignoreElements,
  catchError,
  take,
} from 'rxjs/operators'
import { isEqual, once, compact } from 'lodash'
import tippy, { Props } from 'tippy.js'
import { Position, Range, Sym, contains, SymT, Stencil } from './common'
import { browser } from 'webextension-polyfill-ts'
import stringify from 'fast-json-stable-stringify'
import { pick } from 'lodash'
import {
  DefinitionResult,
  HighlightType,
  observeAttribute,
  observeChildren,
  observeSelector,
  observeSelectorMap,
  renderHover,
} from './common2'

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

type LineSpec = { line: number; kind: 'normal' | 'addition' | 'deletion' }
const findLineNumber = (blobCodeInner: HTMLElement): LineSpec | undefined => {
  // blob or blame
  if (blobCodeInner.closest('.blame-container') || blobCodeInner.closest('.js-file-line-container')) {
    const lineString = blobCodeInner.getAttribute('id')
    if (!lineString) return undefined
    return {
      line: parseInt(lineString.slice(2)) - 1,
      kind: 'normal',
    }
  }

  if (!blobCodeInner.parentElement) return undefined

  // split diff
  const splitSide = blobCodeInner.parentElement.getAttribute('data-split-side')
  if (splitSide) {
    const line = blobCodeInner.parentElement.previousElementSibling?.getAttribute('data-line-number')
    if (line === undefined || line === null) return undefined
    return { line: parseInt(line) - 1, kind: splitSide === 'right' ? 'addition' : 'deletion' }
  }

  // unified diff
  const kind = blobCodeInner.parentElement.classList.contains('blob-code-deletion') ? 'deletion' : 'addition'
  const blobNum =
    kind === 'addition'
      ? blobCodeInner.parentElement.previousElementSibling
      : blobCodeInner.parentElement.previousElementSibling?.previousElementSibling
  const lineStr = blobNum?.getAttribute('data-line-number')
  if (lineStr === undefined || lineStr === null) return undefined
  return { kind, line: parseInt(lineStr) - 1 }
}

const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g

function initCSS() {
  const style = document.createElement('style')
  document.head.appendChild(style)
  const sheet = style.sheet as CSSStyleSheet
  sheet.insertRule(`
@keyframes senpai {
  from {}
  to { background-color: rgba(255, 179, 109, 0.5); }
}
`)
  sheet.insertRule('.codewing-clickable { cursor: pointer }')

  // !important so it shows up even on word diffs.
  sheet.insertRule('.codewing-highlighted { background-color: rgba(255, 179, 109, 0.5) !important }')
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

const senpai = (scrollEl: HTMLElement, highlightEl: HTMLElement) => {
  scrollEl.scrollIntoView({
    behavior: 'smooth', // auto/smooth
    block: 'nearest',
  })
  const intersectionObserver = new IntersectionObserver(isectentries => {
    const [entry] = isectentries
    if (entry.isIntersecting) {
      const old = highlightEl.style.animation
      highlightEl.style.animation = '0.2s ease-in-out 4 alternate senpai'
      setTimeout(() => {
        highlightEl.style.animation = old
        intersectionObserver.disconnect()
      }, 1000)
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

const getUid = async (): Promise<string> => {
  let uid = (await browser.storage.local.get('uid'))['uid']
  if (uid) return uid

  uid = ''
  const alphabet = '0123456789abcdef'
  for (let i = 0; i < 20; i++) uid += alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  await browser.storage.local.set({ uid })
  return uid
}

const $1 = function (selector: string): HTMLElement | undefined {
  return (document.querySelector(selector) ?? undefined) as HTMLElement | undefined
}
const $n = function (selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector))
}

const fetchStencil = async (repoCommitPath: RepoCommitPathMRef): Promise<Stencil> =>
  ((await browser.runtime.sendMessage({
    kind: 'serverCall',
    args: {
      stencil: {
        ...repoCommitPath,
        file: repoCommitPath.path,
        uid: await getUid(),
      },
    },
  })) as string[]).map(range => parseRange(range))

export const parseRange = (rangestr: string): Range => {
  const [row, mid, end] = rangestr.split(':')
  const [cs, rhs] = mid.split('-')
  if (end) return { line: parseInt(row), characterStart: parseInt(cs), characterEnd: parseInt(end) }
  else return { line: parseInt(row), characterStart: parseInt(cs), characterEnd: parseInt(rhs) }
}

type SR = { sym: Sym; definitionResult?: DefinitionResult }

const mkDefinition = (): {
  definition: (range: RepoCommitPathRange) => Promise<SR | undefined>
  symbols: Observable<SR>
} => {
  const symbols = new Subject<SR>()
  const definition = async (range: RepoCommitPathRangeMRef): Promise<SR> => {
    try {
      const result: DefinitionResult = await browser.runtime.sendMessage({
        kind: 'serverCall',
        args: {
          definition: {
            owner: range.owner,
            repo: range.repo,
            commit: range.commit,
            file: range.path,
            line: range.line,
            ref: range.ref,
            column: range.characterStart,
            uid: await getUid(),
          },
        },
      })
      const s: { sym: Sym; definitionResult: DefinitionResult } = {
        sym: {
          references: [
            {
              owner: range.owner,
              repo: range.repo,
              commit: range.commit,
              path: range.path,
              line: range.line,
              characterStart: range.characterStart,
              characterEnd: range.characterEnd,
            },
          ],
          definition: {
            owner: range.owner,
            repo: range.repo,
            commit: range.commit,
            path: result.file,
            line: result.line,
            characterStart: result.column,
            characterEnd: result.column + result.length,
          },
          hover: result.hover.text,
        },
        definitionResult: result,
      }
      if (result) {
        symbols.next(s)
      }
      return s
    } catch (e) {
      return {
        sym: {
          references: [],
          hover: 'No definition found.',
        },
      }
    }
  }

  return {
    definition,
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
  maxWidth: '750px',
  placement: 'top-start',
  // plugins: [mouseRest],
  duration: 50,
  arrow: false,
  allowHTML: true,
  // interactive: true,
  offset: [0, 0],
  appendTo: document.body,
}

const openBlobInNewTab = (range: RepoCommitPathRange): void => {
  window.open(
    `https://github.com/${range.owner}/${range.repo}/blob/${range.commit}/${range.path}#L${range.line + 1}`,
    '_newtab'
  )
}

const openBlobInSameTab = (range: RepoCommitPathRange): void => {
  window.location.href = `https://github.com/${range.owner}/${range.repo}/blob/${range.commit}/${range.path}#L${
    range.line + 1
  }`
}

const onDiffView = (commitSpec: CommitSpec, repo: Repo) => {
  const elDiffView = $1('.diff-view')
  if (!elDiffView) {
    console.warn('expected a .diff-view to be present')
    return EMPTY
  }

  const path2Anchor = new Map<string, string>()
  const j2d = (range: RepoCommitPathRange) => {
    const anchor = path2Anchor.get(stringify(pick(range, 'owner', 'repo', 'path')))
    if (!anchor) return openBlobInNewTab(range)

    const lineNum = findCommitLineNum(anchor, commitSpec, range.commit, range.line)
    if (!lineNum) return openBlobInNewTab(range)

    const next = lineNum.nextElementSibling as HTMLElement
    if (!next) return openBlobInNewTab(range)
    if (next.classList.contains('blob-code')) {
      senpai(lineNum, next)
      return
    }

    const nextNext = lineNum.nextElementSibling as HTMLElement
    if (!nextNext) return openBlobInNewTab(range)
    if (nextNext.classList.contains('blob-code')) {
      senpai(lineNum, nextNext)
      return
    }

    console.warn('j2d: expected to find blob-code')
  }

  const onJsFile = (elJsFile: Element): Observable<never> => {
    // tslint:disable-next-line: prefer-const
    let [basePath, headPath] =
      elJsFile.querySelector('.js-file-header clipboard-copy')?.getAttribute('value')?.split(' → ') ?? []
    if (basePath === undefined) return EMPTY
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
    ).pipe(
      tap(jsDiffTable => {
        const anchor = jsDiffTable.getAttribute('data-diff-anchor')
        if (!anchor) return
        path2Anchor.set(stringify(pick({ ...repo, path: basePath }, 'owner', 'repo', 'path')), anchor)
        path2Anchor.set(stringify(pick({ ...repo, path: headPath }, 'owner', 'repo', 'path')), anchor)
      }),
      switchMap(jsDiffTable =>
        onDiff(jsDiffTable, { ...repo, path: basePath }, { ...repo, path: headPath }, commitSpec, j2d)
      )
    )
  }

  const recur = (curEl: Element): Observable<never> =>
    observeSelectorMap(curEl, ['.js-diff-progressive-container,.js-file'], nextEl =>
      nextEl.classList.contains('js-file') ? onJsFile(nextEl) : recur(nextEl)
    )

  return recur(elDiffView)
}

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
  symbolAt: (range: RepoCommitPathRangeMRef) => Promise<SR | undefined>
): OperatorFunction<
  RepoCommitPathRangeMRef | undefined,
  { sym: SR | undefined; range: RepoCommitPathRange } | undefined
> =>
  concatMap(async range => {
    if (!range) return undefined
    try {
      return { sym: await symbolAt(range), range }
    } catch (e) {
      if (e.message === 'not-ready')
        return { sym: { sym: { hover: 'CodeWing is still processing...', references: [range] } }, range }
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
    catchError(() => EMPTY),
    switchMap(
      ([baseStencil, headStencil]): Observable<never> => {
        const { definition: symbolAt } = mkDefinition()
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
                case 'normal':
                  return await inject(baseStencil, commitSpec.base, basePath)
                default:
                  const _: never = pos.kind
                  throw new Error('onDiff: unexpected kind')
              }
            }),
            unique()
          )

        const findBlobCodeInner = (range: RepoCommitPathRange): HTMLElement | undefined => {
          const lineNum = findCommitLineNum(diffAnchor, commitSpec, range.commit, range.line)
          if (!lineNum) return undefined

          // unified diff and red side of split diff
          const next = lineNum.nextElementSibling
          if (!next) return undefined
          if (next.classList.contains('blob-code'))
            return (next.querySelector('.blob-code-inner') as HTMLElement) ?? undefined

          // green side of split diff
          const nextNext = next.nextElementSibling
          if (!nextNext) return undefined
          if (nextNext.classList.contains('blob-code'))
            return (nextNext.querySelector('.blob-code-inner') as HTMLElement) ?? undefined

          console.warn('expected to find a .blob-code')
          return undefined
        }

        // TODO factor this out and reuse it for blob/blame views
        return fromEvent<MouseEvent>(jsDiffTable, 'mousemove').pipe(
          debounceTime(80),
          positions(),
          pos2Range,
          map(range => range && { ...range, ref: commitSpec.ref }),
          range2Symbol(symbolAt),
          switchMap(showTippy(findBlobCodeInner, j2d)),
          ignoreElements()
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
  const { definition: symbolAt } = mkDefinition()

  const j2d = (range: RepoCommitPathRange) => {
    if (!isEqual({ ...repo, commit, path }, pick(range, ['owner', 'repo', 'commit', 'path'])))
      return openBlobInSameTab(range)
    const lineNum = $1(`[data-line-number="${range.line + 1}"]`) ?? $1(`#L${range.line + 1}`)
    const blobCode = lineNum?.parentElement?.querySelector<HTMLElement>('.blob-code')
    if (!lineNum || !blobCode) return openBlobInSameTab(range)
    senpai(lineNum, blobCode)
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

        return fromEvent<MouseEvent>(jsFileLineContainer, 'mousemove')
          .pipe(
            debounceTime(80),
            positions(),
            pos2Range,
            map(range => range && { ...range, ref }),
            range2Symbol(symbolAt),
            switchMap(showTippy(findBlobCodeInner, j2d))
          )
          .pipe(ignoreElements())
          .subscribe(subscriber)
      })
    })
  )
}

const theme = new Map<HighlightType, string>([
  ['comment', 'var(--color-prettylights-syntax-comment, #6A737D)'],
  ['keyword', 'var(--color-prettylights-syntax-keyword, #D73A49)'],
  ['string', 'var(--color-prettylights-syntax-string, #032F62)'],
])

const showTippy = (
  findBlobCodeInner: (range: RepoCommitPathRange) => HTMLElement | undefined,
  j2d: (range: RepoCommitPathRange) => void
) => (sym: { sym: SR | undefined; range: RepoCommitPathRange } | undefined): Subscribable<never> => {
  if (!sym) return EMPTY
  const symsym = sym.sym
  if (!symsym) return EMPTY

  const currentBlobCodeInner = findBlobCodeInner(sym.range)
  if (!currentBlobCodeInner || !(currentBlobCodeInner instanceof HTMLElement)) {
    console.warn('showTippy: expected blobCodeInner')
    return EMPTY
  }

  const pickRepoCommitPathRange = (range: RepoCommitPathRange): RepoCommitPathRange =>
    pick(range, ['owner', 'repo', 'commit', 'path', 'line', 'characterStart', 'characterEnd'])

  const isDefinition = symsym.sym.definition
    ? isEqual(pickRepoCommitPathRange(sym.range), pickRepoCommitPathRange(symsym.sym.definition))
    : false
  return new Observable(_subscriber => {
    const s = new Subscription()
    // TODO calling tippy() on multiple elements shows multiple tippys. Should only show 1.
    const hoverPieces = selectRange(currentBlobCodeInner, sym.range.characterStart, sym.range.characterEnd)
    const allPieces = symbolRanges(symsym.sym).flatMap(range => {
      if (range.path !== sym.range.path) return []
      const x = findBlobCodeInner(range)
      if (!x) return []
      return selectRange(x, range.characterStart, range.characterEnd)
    })
    const ts = tippy(hoverPieces, {
      ...tippystyleprops,
      showOnCreate: true,
      onShow: () => allPieces.forEach(piece => piece.classList.add('codewing-highlighted')),
      onHide: () => allPieces.forEach(piece => piece.classList.remove('codewing-highlighted')),
      onDestroy: () => allPieces.forEach(piece => piece.classList.remove('codewing-highlighted')),
      content: symsym.definitionResult
        ? renderHover({ file: sym.range.path, definition: symsym.definitionResult, theme })
        : 'No definition found.',
    })
    s.add(() => ts.forEach(t => t.destroy()))
    const def = symsym.sym.definition
    if (def && !isDefinition) {
      const onClick = () => j2d(def)
      hoverPieces.forEach(piece => {
        piece.classList.add('codewing-clickable')
        piece.addEventListener('click', onClick)
        s.add(() => {
          piece.removeEventListener('click', onClick)
          piece.classList.remove('codewing-clickable')
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
    case undefined:
    // support code views in the discussion page
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

const main = async (): Promise<void> => {
  if (!isPublic()) return

  initCSS()

  // CodeWing is either on or off
  type Power = 'on' | 'off'
  const on: Power = 'on'
  const off: Power = 'off'

  // Merge on/off signals and call powerOn() when turned on
  merge<Power>(
    new Observable(subscriber => {
      $(() => {
        subscriber.next(on)
        subscriber.complete()
      })
    }),
    fromEvent(document, 'pjax:start').pipe(mapTo(off)),
    fromEvent(document, 'pjax:end').pipe(mapTo(on))
  )
    .pipe(switchMap(power => (power === on ? powerOn() : EMPTY)))
    .subscribe()
}

// tslint:disable-next-line: no-floating-promises
main()
