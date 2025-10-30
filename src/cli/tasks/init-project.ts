import path from 'node:path';
import { fileExists, ensureDirectory, writeFileSafe, writeJsonFile, readJsonFile } from '../utils/fs';
import type { KickStructureConfig } from '../types';

export interface InitProjectOptions {
  targetDirectory: string;
  force?: boolean;
  packageName?: string;
  structure?: KickStructureConfig;
}

export interface InitProjectResult {
  createdFiles: string[];
  skippedFiles: string[];
}

export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const targetDir = path.resolve(process.cwd(), options.targetDirectory || '.');
  const force = options.force ?? false;
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  await ensureDirectory(targetDir);

  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = (await readJsonFile<Record<string, unknown>>(packageJsonPath)) ?? {};
  if (Object.keys(packageJson).length === 0) {
    const name = options.packageName ??
      (path.basename(targetDir).replace(/[^a-zA-Z0-9-_]/g, '-') || 'kick-app');
    await writeJsonFile(
      packageJsonPath,
      {
        name,
        version: '1.0.0',
        private: true,
        type: 'commonjs',
        main: 'dist/index.js',
        scripts: {
          dev: 'kick dev',
          build: 'kick build',
          start: 'kick start',
          typecheck: 'tsc --noEmit',
          clean: 'rimraf dist'
        },
        dependencies: {
          '@forinda/kickjs': 'latest',
          express: '^5.1.0',
          inversify: '^7.10.0',
          'reflect-metadata': '^0.2.2'
        },
        devDependencies: {
          '@types/express': '^5.0.3',
          '@types/node': '^24.5.2',
          rimraf: '^5.0.0',
          'ts-node-dev': '^2.0.0',
          tsup: '^8.5.0',
          tsx: '^4.20.6',
          typescript: '^5.9.2'
        },
        engines: {
          node: '>=20.0.0'
        }
      },
      { force: true }
    );
    createdFiles.push('package.json');
  } else {
    skippedFiles.push('package.json');
  }

  const tsconfigPath = path.join(targetDir, 'tsconfig.json');
  const tsconfigExists = await fileExists(tsconfigPath);
  if (!tsconfigExists || force) {
    await writeJsonFile(
      tsconfigPath,
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'node',
          lib: ['ES2022'],
          rootDir: 'src',
          outDir: 'dist',
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          strict: true,
          noImplicitAny: true,
          strictNullChecks: true,
          strictFunctionTypes: true,
          noImplicitReturns: true,
          noFallthroughCasesInSwitch: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          exactOptionalPropertyTypes: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          declaration: true,
          declarationMap: true,
          sourceMap: true
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.spec.ts']
      },
      { force: true }
    );
    createdFiles.push('tsconfig.json');
  } else {
    skippedFiles.push('tsconfig.json');
  }

  const mainFilePath = path.join(targetDir, 'src', 'index.ts');
  const mainCreated = await writeFileSafe(
    mainFilePath,
    `import 'reflect-metadata';
import express from 'express';
import { createKickAppWithConfig } from '@forinda/kickjs';
import { AppModule } from './app.module';

async function startApp() {
  const app = express();
  app.use(express.json());

  const server = await createKickAppWithConfig({
    app,
    modules: [AppModule]
  });

  const port = server.kickApp.getConfig('port') || 3000;
  const host = server.kickApp.getConfig('host') || 'localhost';
  
  server.listen(port, () => {
    console.log(\`🚀 \${server.kickApp.getConfig('name')} running on http://\${host}:\${port}\`);
    console.log(\`📊 App Stats:\`, server.getStats());
  });
}

startApp().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
`,
    { force }
  );
  
  if (mainCreated) {
    createdFiles.push('src/index.ts');
  } else {
    skippedFiles.push('src/index.ts');
  }

  // Create app module
  const appModulePath = path.join(targetDir, 'src', 'app.module.ts');
  const appModuleCreated = await writeFileSafe(
    appModulePath,
    `import { createModule } from '@forinda/kickjs';
import { UserController } from './controllers/user.controller';
import { UserService } from './services/user.service';

export const AppModule = createModule('app', {
  controllers: [UserController],
  services: [UserService]
});
`,
    { force }
  );
  
  if (appModuleCreated) {
    createdFiles.push('src/app.module.ts');
  } else {
    skippedFiles.push('src/app.module.ts');
  }

  // Create domain structure
  const domainBase = path.join(targetDir, 'src');
  for (const folder of ['controllers', 'services', 'types']) {
    const folderPath = path.join(domainBase, folder);
    const exists = await fileExists(folderPath);
    await ensureDirectory(folderPath);
    const relativePath = path.relative(targetDir, folderPath);
    if (!exists) {
      createdFiles.push(relativePath);
    } else {
      skippedFiles.push(relativePath);
    }
  }

  // Create sample controller
  const controllerPath = path.join(targetDir, 'src', 'controllers', 'user.controller.ts');
  const controllerCreated = await writeFileSafe(
    controllerPath,
    `import { 
  KickController, 
  KickGet, 
  KickPost, 
  KickRequestContext,
  KickInject 
} from '@forinda/kickjs';
import { UserService } from '../services/user.service';

@KickController('/users')
export class UserController {
  constructor(
    @KickInject(UserService)
    private readonly userService: UserService
  ) {}

  @KickGet('/')
  async getUsers(context: KickRequestContext) {
    const { res } = context;
    const users = await this.userService.findAll();
    
    res.json({
      users,
      requestId: context.meta.requestId,
      timestamp: context.meta.startTime
    });
  }

  @KickPost('/')
  async createUser(context: KickRequestContext) {
    const { req, res } = context;
    
    if (!req.body.name || !req.body.email) {
      return res.status(400).json({
        error: 'Name and email are required',
        requestId: context.meta.requestId
      });
    }

    const user = await this.userService.create(req.body);
    res.status(201).json({
      user,
      requestId: context.meta.requestId
    });
  }
}
`,
    { force }
  );
  const relativeControllerPath = path.relative(targetDir, controllerPath);
  
  if (controllerCreated) {
    createdFiles.push(relativeControllerPath);
  } else {
    skippedFiles.push(relativeControllerPath);
  }

  // Create sample service
  const servicePath = path.join(targetDir, 'src', 'services', 'user.service.ts');
  const serviceCreated = await writeFileSafe(
    servicePath,
    `import { KickInjectable } from '@forinda/kickjs';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

@KickInjectable()
export class UserService {
  private users: User[] = [];

  async findAll(): Promise<User[]> {
    return this.users;
  }

  async create(userData: { name: string; email: string }): Promise<User> {
    const user: User = {
      id: Math.random().toString(36).substr(2, 9),
      name: userData.name,
      email: userData.email,
      createdAt: new Date()
    };
    
    this.users.push(user);
    return user;
  }

  async findById(id: string): Promise<User | undefined> {
    return this.users.find(user => user.id === id);
  }
}
`,
    { force }
  );
  const relativeServicePath = path.relative(targetDir, servicePath);
  
  if (serviceCreated) {
    createdFiles.push(relativeServicePath);
  } else {
    skippedFiles.push(relativeServicePath);
  }

  // Create types file
  const typesPath = path.join(targetDir, 'src', 'types', 'user.types.ts');
  const typesCreated = await writeFileSafe(
    typesPath,
    `export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface CreateUserRequest {
  name: string;
  email: string;
}

export interface UserResponse {
  user: User;
  requestId: string;
}
`,
    { force }
  );
  const relativeTypesPath = path.relative(targetDir, typesPath);
  
  if (typesCreated) {
    createdFiles.push(relativeTypesPath);
  } else {
    skippedFiles.push(relativeTypesPath);
  }

  // Create kick configuration
  const configPath = path.join(targetDir, 'kick.config.js');
  const configCreated = await writeFileSafe(
    configPath,
    `module.exports = {
  app: {
    name: '${options.packageName || 'kick-app'}',
    port: 3000,
    host: 'localhost',
    prefix: '/api/v1',
    env: 'development'
  },
  dev: {
    port: 3000,
    host: 'localhost',
    entry: 'src/index.ts',
    watch: true,
    env: {
      NODE_ENV: 'development',
      DEBUG: 'app:*'
    }
  },
  start: {
    port: 3000,
    host: '0.0.0.0',
    entry: 'dist/index.js',
    env: {
      NODE_ENV: 'production'
    }
  }
};
`,
    { force }
  );
  
  if (configCreated) {
    createdFiles.push('kick.config.js');
  } else {
    skippedFiles.push('kick.config.js');
  }

  // Create additional project files
  
  // Create .gitignore
  const gitignorePath = path.join(targetDir, '.gitignore');
  const gitignoreCreated = await writeFileSafe(
    gitignorePath,
    `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Build outputs
dist/
build/
*.tsbuildinfo

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# OS files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# next.js build output
.next

# nuxt.js build output
.nuxt

# vuepress build output
.vuepress/dist

# Serverless directories
.serverless

# FuseBox cache
.fusebox/

# DynamoDB Local files
.dynamodb/

# TernJS port file
.tern-port
`,
    { force }
  );
  
  if (gitignoreCreated) {
    createdFiles.push('.gitignore');
  } else {
    skippedFiles.push('.gitignore');
  }

  // Create README.md
  const readmePath = path.join(targetDir, 'README.md');
  const readmeCreated = await writeFileSafe(
    readmePath,
    `# ${options.packageName || 'kick-app'}

A modern TypeScript API built with KickJS framework.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm, pnpm, or yarn

### Installation

\`\`\`bash
npm install
\`\`\`

### Development

\`\`\`bash
# Start development server with hot reload
npm run dev
\`\`\`

### Building

\`\`\`bash
# Build for production
npm run build
\`\`\`

### Running in Production

\`\`\`bash
# Start production server
npm start
\`\`\`

## 📁 Project Structure

\`\`\`
src/
├── controllers/          # HTTP route controllers
├── services/             # Business logic services
├── types/                # TypeScript type definitions
├── app.module.ts         # Main application module
└── index.ts              # Application entry point
\`\`\`

## 🛠️ Available Scripts

- \`npm run dev\` - Start development server with hot reload
- \`npm run build\` - Build for production
- \`npm start\` - Start production server
- \`npm run typecheck\` - Type check without building
- \`npm run clean\` - Clean build directory

## 📚 Learn More

- [KickJS Documentation](https://github.com/forinda/kick-js)
- [Express.js](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Inversify](https://inversify.io/)

## 🎯 API Endpoints

### Users

- \`GET /api/v1/users\` - Get all users
- \`POST /api/v1/users\` - Create a new user

Example request:
\`\`\`bash
curl -X POST http://localhost:3000/api/v1/users \\
  -H "Content-Type: application/json" \\
  -d '{"name": "John Doe", "email": "john@example.com"}'
\`\`\`

## 📄 License

MIT
`,
    { force }
  );
  
  if (readmeCreated) {
    createdFiles.push('README.md');
  } else {
    skippedFiles.push('README.md');
  }

  // Create tsup config for building
  const tsupConfigPath = path.join(targetDir, 'tsup.config.ts');
  const tsupConfigCreated = await writeFileSafe(
    tsupConfigPath,
    `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  outDir: 'dist',
  splitting: false,
  minify: false,
  external: ['express']
});
`,
    { force }
  );
  
  if (tsupConfigCreated) {
    createdFiles.push('tsup.config.ts');
  } else {
    skippedFiles.push('tsup.config.ts');
  }

  return { createdFiles, skippedFiles };
};
