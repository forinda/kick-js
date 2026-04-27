export interface IndexDecl {
  name: string
  columns: string[]
  unique: boolean
}

interface ColRef {
  __name: string
}

export function index(name: string) {
  return {
    on(...cols: ColRef[]): IndexDecl {
      return { name, columns: cols.map((c) => c.__name), unique: false }
    },
  }
}

export function unique(name: string) {
  return {
    on(...cols: ColRef[]): IndexDecl {
      return { name, columns: cols.map((c) => c.__name), unique: true }
    },
  }
}
