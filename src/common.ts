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

export type PLFile = {
  owner: string
  repo: string
  commit: string
  path: string
}

export type RequestType = 'serverCall'

export const examples = [
  {
    language: 'Python',
    linktext: 'https://github.com/Rapptz/discord.py discord/sticker.py',
    url: 'https://github.com/Rapptz/discord.py/blob/a3a6f88936146b35b260b524e1eb22a324ee89b8/discord/sticker.py#L76',
  },
  {
    language: 'Java',
    linktext: 'https://github.com/seata/seata AbstractRpcRemoting.java',
    url:
      'https://github.com/seata/seata/blob/c860c6bbb95ef45e72834d6bab9ed404b062b1ee/core/src/main/java/io/seata/core/rpc/netty/AbstractRpcRemoting.java#L333',
  },
  {
    language: 'Go',
    linktext: 'https://github.com/hashicorp/terraform context_input.go',
    url:
      'https://github.com/hashicorp/terraform/blob/03a4432595bce8b36e5dd89c232d9d484f2670b4/terraform/context_input.go#L55',
  },
]
