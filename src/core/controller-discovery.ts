import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import 'reflect-metadata';
import type { ControllerConstructor, RouteDefinition } from '../decorators/http';
import { DecoratorMetadata, registerController } from '../decorators/http';
import type { HttpMethod } from '../decorators/http';
import type { ResolvedControllerDiscoveryConfig } from '../shared/config';
import { createError } from '../utils/errors';
import { HttpVerbController, isVerbController } from './http-controllers';

export interface DiscoveredController {
  controller: ControllerConstructor;
  filePath: string;
  route: string;
  method: HttpMethod;
  tags: string[];
}

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];
let tsNodeRegistered = false;

export function discoverControllersFromFilesystem(
  config: ResolvedControllerDiscoveryConfig
): DiscoveredController[] {
  if (!config.enabled) {
    return [];
  }

  const discovered: DiscoveredController[] = [];
  const seen = new Map<string, string>();
  const resolvedRoots = config.roots.map((root) => (path.isAbsolute(root) ? root : path.join(process.cwd(), root)));

  resolvedRoots.forEach((root) => {
    if (!safeExistsSync(root)) {
      return;
    }
    traverseDirectory(root, root, [], config, (filePath, dirSegments) => {
      const discovery = interpretControllerFile(root, filePath, dirSegments, config);
      if (!discovery) {
        return;
      }

      const key = `${discovery.method}:${discovery.route}`;
      if (seen.has(key)) {
        throw createError('ROUTE_CONFLICT', `Duplicate discovered route for [${discovery.method.toUpperCase()}] ${discovery.route}`, {
          details: {
            existing: seen.get(key),
            duplicate: filePath
          }
        });
      }
      seen.set(key, filePath);

      annotateController(discovery.controller, discovery.route, discovery.method, discovery.tags);
      if (config.registerGlobally) {
        registerController(discovery.controller);
      }

      discovered.push(discovery);
    });
  });

  return discovered;
}

function traverseDirectory(
  root: string,
  directory: string,
  segments: string[],
  config: ResolvedControllerDiscoveryConfig,
  onFile: (filePath: string, dirSegments: string[]) => void
) {
  const entries = readdirSync(directory, { withFileTypes: true });

  entries.forEach((entry) => {
    if (shouldIgnore(entry.name, config)) {
      return;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      traverseDirectory(root, entryPath, [...segments, entry.name], config, onFile);
      return;
    }

    if (!entry.isFile()) {
      return;
    }

    onFile(entryPath, segments);
  });
}

function interpretControllerFile(
  root: string,
  filePath: string,
  dirSegments: string[],
  config: ResolvedControllerDiscoveryConfig
): DiscoveredController | undefined {
  const ext = path.extname(filePath);
  if (!config.extensions.includes(ext)) {
    return undefined;
  }

  const relative = path.relative(root, filePath);
  const fileName = path.basename(relative, ext);

  const normalized = stripSuffix(fileName, config.suffix);
  const { slug, method } = extractSlugAndMethod(normalized, config);
  if (!slug || !method) {
    if (config.enforceStructure) {
      throw createError('INVALID_CONTROLLER_STRUCTURE', `Controller file ${relative} must follow <name>.<verb>${config.suffix}${ext}`);
    }
    return undefined;
  }

  const controllerConstructor = loadController(filePath);
  if (!controllerConstructor) {
    return undefined;
  }

  if (!isVerbController(controllerConstructor)) {
    throw createError('INVALID_VERB_CONTROLLER', `Discovered controller ${controllerConstructor.name || filePath} must extend HttpVerbController.`);
  }

  const VerbController = controllerConstructor as unknown as typeof HttpVerbController;
  const methodFromClass = VerbController.method();
  if (methodFromClass !== method) {
    throw createError('VERB_MISMATCH', `Controller ${VerbController.name} declares ${methodFromClass.toUpperCase()} but file name enforces ${method.toUpperCase()}.`, {
      details: {
        filePath
      }
    });
  }

  const derivedSegments = buildRouteSegments(dirSegments, slug, config);
  const baseSegments = toSegments(config.baseRoute);
  const override = config.allowStaticRoutes ? extractStaticRoute(VerbController) : undefined;
  const overrideSegments = override ? toSegments(override.startsWith('/') ? override : joinSegments([...baseSegments, override])) : undefined;

  const finalSegments = overrideSegments ?? [...baseSegments, ...derivedSegments];
  const route = normalizeRoute(finalSegments);
  const tags = buildTags(VerbController, dirSegments, config);

  return {
    controller: controllerConstructor,
    filePath,
    route,
    method,
    tags
  };
}

function buildTags(
  controller: typeof HttpVerbController,
  dirSegments: string[],
  config: ResolvedControllerDiscoveryConfig
) {
  const staticTags = Array.isArray(controller.tags) ? controller.tags : [];
  if (!config.tagsFromDirectories) {
    return [...new Set(staticTags)];
  }

  const derived = dirSegments
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9]/g, '-').toLowerCase());

  return [...new Set([...staticTags, ...derived])];
}

function extractStaticRoute(controller: typeof HttpVerbController) {
  const route = controller.route;
  if (!route) {
    return undefined;
  }
  return route;
}

function buildRouteSegments(
  dirSegments: string[],
  slugSegments: string[],
  config: ResolvedControllerDiscoveryConfig
) {
  const directoryParts = dirSegments.flatMap((segment) => interpretSegment(segment, false));
  const slugParts = slugSegments.flatMap((segment, index) => interpretSegment(segment, true, index === slugSegments.length - 1));
  const segments = [...directoryParts, ...slugParts];
  if (segments.length === 0) {
    return ['/'];
  }
  return segments;
}

function interpretSegment(segment: string, fromFile: boolean, isLastFilePart = false) {
  if (!segment) {
    return [] as string[];
  }

  if (segment === 'index' && fromFile && isLastFilePart) {
    return [] as string[];
  }

  const dynamic = segment.match(/^\[(\.\.\.)?(.+)]$/);
  if (dynamic) {
    const [, spread, name] = dynamic;
    if (spread) {
      return [`:${name}*`];
    }
    return [`:${name}`];
  }

  return [segment];
}

function normalizeRoute(segments: string[]) {
  const filtered = segments
    .flat()
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '/');

  if (filtered.length === 0) {
    return '/';
  }

  return `/${filtered.join('/')}`.replace(/\/+/g, '/');
}

function stripSuffix(fileName: string, suffix: string) {
  if (!suffix) {
    return fileName;
  }
  return fileName.endsWith(suffix) ? fileName.slice(0, -suffix.length) : fileName;
}

function extractSlugAndMethod(fileName: string, config: ResolvedControllerDiscoveryConfig) {
  const parts = fileName.split('.').filter(Boolean);
  if (parts.length === 0) {
    return { slug: undefined, method: undefined };
  }

  const potentialMethod = parts[parts.length - 1].toLowerCase();
  if (!HTTP_METHODS.includes(potentialMethod as HttpMethod)) {
    return { slug: undefined, method: undefined };
  }

  const slugString = fileName.slice(0, fileName.length - potentialMethod.length - 1);
  const slugSegments = slugString ? slugString.split(config.segmentSeparator).filter(Boolean) : ['index'];

  return {
    slug: slugSegments,
    method: potentialMethod as HttpMethod
  };
}

function loadController(filePath: string): ControllerConstructor | undefined {
  const ext = path.extname(filePath);
  if (ext === '.ts' || ext === '.tsx') {
    ensureTsNode();
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const required = require(filePath);
  const exported = required?.default ?? required?.Controller ?? pickFirstConstructor(required);
  if (typeof exported !== 'function') {
    return undefined;
  }

  return exported as ControllerConstructor;
}

function pickFirstConstructor(exportsObject: unknown) {
  if (!exportsObject || typeof exportsObject !== 'object') {
    return undefined;
  }

  return Object.values(exportsObject).find((value) => typeof value === 'function');
}

function ensureTsNode() {
  if (tsNodeRegistered) {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('ts-node/register');
    tsNodeRegistered = true;
  } catch (error) {
    throw createError(
      'TS_NODE_REQUIRED',
      'Unable to load TypeScript controllers. Install ts-node or run with a TS-aware runner.'
    );
  }
}

function shouldIgnore(name: string, config: ResolvedControllerDiscoveryConfig) {
  if (!name) {
    return true;
  }

  if (name.startsWith('.')) {
    return true;
  }

  return config.ignore.includes(name);
}

function safeExistsSync(target: string) {
  try {
    const stats = statSync(target);
    return stats.isDirectory();
  } catch (error) {
    return false;
  }
}

function toSegments(value: string) {
  if (!value || value === '/') {
    return [] as string[];
  }
  return value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function joinSegments(segments: string[]) {
  return segments.filter(Boolean).join('/');
}

function annotateController(
  controller: ControllerConstructor,
  route: string,
  method: HttpMethod,
  tags: string[]
) {
  const basePath = route === '/' ? '/' : route;
  Reflect.defineMetadata(
    DecoratorMetadata.CONTROLLER_KEY,
    {
      basePath,
      tags
    },
    controller
  );

  const handleKey: string | symbol = 'handle';
  const descriptor = controller.prototype?.[handleKey];
  if (typeof descriptor !== 'function') {
    throw createError('INVALID_CONTROLLER_HANDLER', `Controller ${controller.name || '[anonymous]'} must implement a handle method.`);
  }

  const routes: RouteDefinition[] = [
    {
      method,
      path: '',
      propertyKey: handleKey,
      middlewares: []
    }
  ];

  Reflect.defineMetadata(DecoratorMetadata.ROUTES_KEY, routes, controller);
}
