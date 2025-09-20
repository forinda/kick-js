import path from 'node:path';
import { writeFileSafe } from '../utils/fs';

const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export type SupportedMethod = (typeof SUPPORTED_METHODS)[number];

export interface GenerateControllerOptions {
  name: string;
  method?: SupportedMethod | string;
  root?: string;
  force?: boolean;
  tags?: string[];
}

export interface GenerateControllerResult {
  filePath: string;
  created: boolean;
}

export async function generateController(options: GenerateControllerOptions): Promise<GenerateControllerResult> {
  const method = normalizeMethod(options.method);
  const root = options.root ?? 'src/http';
  const rootPath = path.isAbsolute(root) ? root : path.join(process.cwd(), root);
  const normalizedName = options.name.replace(/\\/g, '/');
  const segments = normalizedName.split('/').filter(Boolean);
  const fileSegment = segments.pop() ?? 'index';

  const relativeDir = segments.join('/');
  const fileName = `${fileSegment}.${method}.controller.ts`;
  const targetFile = path.join(rootPath, relativeDir, fileName);

  const className = buildClassName([...segments, fileSegment], method);
  const methodController = `${capitalize(method)}Controller`;

  const template = buildTemplate({ className, methodController, method, tags: options.tags });

  const created = await writeFileSafe(targetFile, template, { force: options.force });

  return { filePath: targetFile, created };
}

function normalizeMethod(raw?: string): SupportedMethod {
  const method = (raw ?? 'get').toLowerCase();
  if (!SUPPORTED_METHODS.includes(method as SupportedMethod)) {
    throw new Error(`Unsupported method "${raw}". Supported methods: ${SUPPORTED_METHODS.join(', ')}`);
  }
  return method as SupportedMethod;
}

function buildTemplate(params: {
  className: string;
  methodController: string;
  method: SupportedMethod;
  tags?: string[];
}) {
  const tagsBlock = params.tags && params.tags.length > 0 ? `  static tags = ${JSON.stringify(params.tags)};\n\n` : '';

  const requestType = params.method === 'get' || params.method === 'delete' ? 'Request' : 'Request';

  return `import type { Request, Response } from 'express';\nimport { ${params.methodController} } from '@forinda/kickjs';\n\nexport default class ${params.className} extends ${params.methodController} {\n${tagsBlock}  handle(_req: ${requestType}, res: Response) {\n    return this.ok(res, { message: '${humanize(params.method)} ${params.className}' });\n  }\n}\n`;
}

function humanize(method: string) {
  return method.toUpperCase();
}

function buildClassName(segments: string[], method: string) {
  const normalizedSegments = segments
    .map((segment) => segment.replace(/\.\.\./g, 'Rest'))
    .map((segment) => segment.replace(/\[(.+?)]/g, '$1'))
    .flatMap((segment) => segment.split(/[^a-zA-Z0-9]+/g))
    .filter(Boolean)
    .map(capitalize);

  if (normalizedSegments.length === 0) {
    normalizedSegments.push('Root');
  }

  normalizedSegments.push(capitalize(method), 'Controller');
  return normalizedSegments.join('');
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
