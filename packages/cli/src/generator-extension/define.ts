// The generator contract moved to `@forinda/kickjs-cli-kit` so packages
// can ship `kick g <name>` scaffolders without depending on
// `@forinda/kickjs-cli`. Re-exported here for back-compat — existing
// imports from `'../generator-extension/define'` (and the public
// `@forinda/kickjs-cli` surface) keep resolving.

export {
  defineGenerator,
  type GeneratorSpec,
  type GeneratorContext,
  type GeneratorFile,
  type GeneratorArg,
  type GeneratorFlag,
} from '@forinda/kickjs-cli-kit'
