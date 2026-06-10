# KickJS Tutorials

Short, concept-focused tutorials for [KickJS](https://forinda.github.io/kick-js/) — the decorator-driven Node.js framework on Express 5 + TypeScript. Each one teaches **one idea**, with runnable code and a "why it matters".

Every tutorial carries YAML frontmatter (`title`, `subtitle`, `number`, `tag`, `accent`) that the thumbnail generator reads — see [`thumbnails/`](./thumbnails/).

## Tutorials

| #   | Tutorial                                                         | Concept                                   |
| --- | ---------------------------------------------------------------- | ----------------------------------------- |
| 01  | [Decorators & DI](./01-decorators-and-di.md)                     | The container that wires everything       |
| 02  | [Modules, Controllers & Routes](./02-modules-and-controllers.md) | Structuring an app                        |
| 03  | [Validation & Schema](./03-validation-and-schema.md)             | Zod / Valibot / Yup, one interface        |
| 04  | [Configuration & Env](./04-configuration-and-env.md)             | Typed env that hot-reloads                |
| 05  | [Database (kickjs-db)](./05-database.md)                         | Code-first schema, migrations, 3 dialects |
| 06  | [CLI Plugins & Generators](./06-cli-plugins.md)                  | Extend the `kick` CLI                     |

## Run the examples

```bash
npm create @forinda/kickjs@latest my-api
cd my-api && kick dev
```

## Generate thumbnails

```bash
cd tutorials/thumbnails
pip install -r requirements.txt
python generate_thumbnails.py        # renders out/<slug>.png for every tutorial
```
