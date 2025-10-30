# KickJS

🚀 A modern, decorator-driven TypeScript framework built on Express with dependency injection, reactive state management, and enterprise-ready features.

## ✨ Features

- **Decorator-Driven Architecture**: Spring Boot-style controllers with `@KickController`, `@KickGet`, `@KickPost`, etc.
- **Dependency Injection**: Powered by Inversify with automatic binding and container management
- **Reactive State Management**: Built-in EventEmitter-based state with observable properties
- **Middleware System**: Priority-based middleware with both global and DI-managed middlewares
- **Request Context Injection**: Automatic injection of request context with metadata
- **Route Prefixing**: Flexible API prefixing for better organization
- **Module System**: Organize your application into reusable, self-contained modules
- **Auto-Binding**: Automatic method binding with `@AutoBind` decorator
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## 📦 Installation

```bash
npm install @forinda/kickjs
# or
pnpm add @forinda/kickjs
# or
yarn add @forinda/kickjs
```

## 🏗️ Creating Your First App

### Basic Setup

```typescript
// src/index.ts
import express from "express";
import { createKickApp, KickController, KickGet, KickRequestContext } from "@forinda/kickjs";
import { AppModule } from "./app.module";

const app = express();
app.use(express.json());

const server = createKickApp({
  name: "MyApp",
  prefix: "/api/v1", // Optional: prefix all routes
  app,
  modules: [AppModule]
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
  console.log("📊 App Stats:", server.getStats());
});
```

### Creating Controllers

Controllers are the heart of your KickJS application. They handle HTTP requests and contain your business logic.

```typescript
// src/controllers/users.controller.ts
import { 
  KickController, 
  KickGet, 
  KickPost, 
  KickRequestContext,
  KickInject 
} from "@forinda/kickjs";
import { UserService } from "../services/user.service";

@KickController("/users")
export class UserController {
  constructor(
    @KickInject(UserService)
    private readonly userService: UserService
  ) {}

  @KickGet("/")
  async getUsers(context: KickRequestContext) {
    const { res } = context;
    const users = await this.userService.findAll();
    
    res.json({
      users,
      requestId: context.meta.requestId,
      timestamp: context.meta.startTime
    });
  }

  @KickPost("/")
  async createUser(context: KickRequestContext) {
    const { req, res } = context;
    
    if (!req.body.name || !req.body.email) {
      return res.status(400).json({
        error: "Name and email are required",
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
```

### Configuration

KickJS supports flexible configuration through `kick.config.ts` files. This provides type safety and prevents configuration errors.

```typescript
// kick.config.ts
import { createKickConfig } from "@forinda/kickjs";

export default createKickConfig({
  app: {
    name: 'My App',
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
});
```

#### Using Configuration in Your App

```typescript
// src/index.ts
import { createKickAppWithConfig } from "@forinda/kickjs";
import { AppModule } from "./app.module";

async function startApp() {
  const server = await createKickAppWithConfig({
    app: express(),
    modules: [AppModule]
  });

  // Access config in your app
  console.log('App Name:', server.kickApp.getConfig('name'));
  console.log('API Prefix:', server.kickApp.getConfig('prefix'));
  
  // Config with fallback
  const theme = server.kickApp.getConfigOrDefault('ui.theme', 'dark');
  
  const port = server.kickApp.getConfig('port') || 3000;
  server.listen(port, () => {
    console.log(`🚀 ${server.kickApp.getConfig('name')} running on port ${port}`);
  });
}

startApp();
```

#### CLI Configuration Support

The KickJS CLI automatically loads your configuration:

```bash
# Uses config file values
kick dev

# Override specific values
kick dev --port 8080 --host 0.0.0.0

# Production mode
kick start --port 3000
```

### Creating Services

Services contain your business logic and can be injected into controllers and other services.

```typescript
// src/services/user.service.ts
import { KickInjectable } from "@forinda/kickjs";

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
```

### Creating Modules

Modules help organize your application by grouping related controllers, services, and middlewares.

```typescript
// src/app.module.ts
import { createModule } from "@forinda/kickjs";
import { UserController } from "./controllers/user.controller";
import { UserService } from "./services/user.service";
import { LoggingMiddleware } from "./middlewares/logging.middleware";

export const AppModule = createModule("app", {
  controllers: [UserController],
  services: [UserService], // Register your services
  middlewares: [LoggingMiddleware] // Optional: DI-managed middlewares
});
```

## 🛠️ Creating Middlewares

KickJS supports two types of middlewares: global middlewares and DI-managed middlewares.

### DI-Managed Middlewares (Recommended)

These middlewares are managed by the dependency injection container and can inject services.

```typescript
// src/middlewares/logging.middleware.ts
import { 
  KickMiddleware, 
  KickAppMiddleware, 
  KickRequest, 
  KickResponse, 
  KickNextFn 
} from "@forinda/kickjs";

@KickMiddleware({ 
  name: "RequestLogger", 
  priority: 1, // Lower numbers execute first
  global: true,
  tags: ["logging", "development"] 
})
export class LoggingMiddleware implements KickAppMiddleware {
  use(req: KickRequest, res: KickResponse, next: KickNextFn): void {
    const start = Date.now();
    
    console.log(`→ ${req.method} ${req.url}`);
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`← ${req.method} ${req.url} ${res.statusCode} (${duration}ms)`);
    });
    
    next();
  }
}
```

### Global Middlewares

Global middlewares are not managed by DI and are useful for framework-level concerns like CORS.

```typescript
// src/middlewares/cors.middleware.ts
import { KickAppMiddleware, KickRequest, KickResponse, KickNextFn } from "@forinda/kickjs";

export class CorsMiddleware implements KickAppMiddleware {
  use(req: KickRequest, res: KickResponse, next: KickNextFn): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    next();
  }
}
```

Register global middlewares when creating your app:

```typescript
const corsMiddleware = new CorsMiddleware();

const server = createKickApp({
  name: "MyApp",
  app,
  globalMiddlewares: [corsMiddleware], // Global middlewares
  modules: [AppModule] // DI-managed middlewares are in modules
});
```

## 🔌 Creating Plugins

Plugins allow you to extend the application context during initialization.

```typescript
// src/plugins/database.plugin.ts
import { KickAppPlugin, KickApplicationContext } from "@forinda/kickjs";

export class DatabasePlugin implements KickAppPlugin {
  install(context: KickApplicationContext): void {
    // Initialize database connection
    console.log("🗄️  Database plugin initialized");
    
    // Add database middleware or modify app
    context.app.use((req, res, next) => {
      // Add database connection to request
      (req as any).db = /* your database connection */;
      next();
    });
  }
}
```

Use plugins in your app:

```typescript
const dbPlugin = new DatabasePlugin();

const server = createKickApp({
  name: "MyApp",
  app,
  plugins: [dbPlugin],
  modules: [AppModule]
});
```

## 🎯 Advanced Features

### Request Context

Every controller method receives a `KickRequestContext` with rich metadata:

```typescript
interface KickRequestContext {
  req: KickRequest;        // Express request
  res: KickResponse;       // Express response  
  next: KickNextFn;        // Express next function
  meta: {
    routePath: string;     // Route pattern
    method: string;        // HTTP method
    controllerName: string; // Controller class name
    handlerName: string;   // Method name
    startTime: number;     // Request start timestamp
    requestId: string;     // Unique request ID
  };
}
```

### Reactive State Management

KickApp includes reactive state management:

```typescript
// Set state
server.kickApp.setState('userCount', 42);

// Listen to state changes
server.kickApp.onStateChange('userCount', (data) => {
  console.log(`User count changed: ${data.oldValue} → ${data.value}`);
});

// Get current state
const currentState = server.kickApp.state;
```

### Event System

Listen to application events:

```typescript
server.kickApp.on('route:registered', (route) => {
  console.log(`Route registered: ${route.method} ${route.path}`);
});

server.kickApp.on('middleware:registered', (middleware) => {
  console.log(`Middleware registered: ${middleware.count} middlewares`);
});

server.kickApp.on('controller:mapped', (controller) => {
  console.log(`Controller mapped: ${controller.controller}`);
});
```

### Error Handling

Add global error handlers:

```typescript
server.addErrorHandler((errorData) => {
  console.error('Application error:', errorData);
  // Send to logging service, etc.
});
```

## 🚀 Running Your Application

### Development

```bash
# Using tsx for development
npx tsx watch src/index.ts

# Or with nodemon
npx nodemon --exec tsx src/index.ts
```

### Production

```bash
# Build your TypeScript
npx tsc

# Run the compiled JavaScript
node dist/index.js
```

### Example Scripts (package.json)

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest"
  }
}
```

## 📁 Project Structure

```
src/
├── controllers/          # HTTP controllers
│   ├── user.controller.ts
│   └── auth.controller.ts
├── services/             # Business logic services
│   ├── user.service.ts
│   └── auth.service.ts
├── middlewares/          # Custom middlewares
│   ├── logging.middleware.ts
│   └── auth.middleware.ts
├── plugins/              # Application plugins
│   └── database.plugin.ts
├── types/                # Type definitions
│   └── user.types.ts
├── modules/              # Application modules
│   ├── user.module.ts
│   └── auth.module.ts
└── index.ts              # Application entry point
```

## 📚 API Reference

### Decorators

- `@KickController(path)` - Define a controller class
- `@KickGet(path)` - HTTP GET route
- `@KickPost(path)` - HTTP POST route  
- `@KickPut(path)` - HTTP PUT route
- `@KickPatch(path)` - HTTP PATCH route
- `@KickDelete(path)` - HTTP DELETE route
- `@KickMiddleware(options)` - Define a middleware class
- `@KickInject(token)` - Inject dependencies
- `@KickInjectable()` - Mark class as injectable service
- `@AutoBind` - Automatically bind class methods

### Core Functions

- `createKickApp(options)` - Create a KickJS application
- `createModule(name, options)` - Create a module
- `isKickMiddleware(target)` - Check if class is a middleware
- `getMiddlewareMetadata(target)` - Get middleware metadata

### Types

- `KickRequestContext` - Request context interface
- `KickAppMiddleware` - Middleware interface  
- `KickAppPlugin` - Plugin interface
- `KickApplicationContext` - Application context interface

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for detailed information on how to get started.

### Quick Start for Contributors

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/kickjs.git
   cd kickjs
   pnpm install
   ```

2. **Run tests to ensure everything works**
   ```bash
   pnpm test
   pnpm build
   ```

3. **Create a feature branch and make your changes**
   ```bash
   git checkout -b feature/amazing-feature
   # Make your changes...
   git commit -m "feat: add amazing feature"
   ```

4. **Submit a pull request**

For detailed guidelines, development setup, coding standards, and more, please read our [Contributing Guide](CONTRIBUTING.md).

### 📞 Getting Help

- 📖 Check the [documentation](README.md) and [examples](examples/)
- 🐛 Search [existing issues](https://github.com/forinda/kickjs/issues)
- 💬 Join our community discussions
- 📧 Contact maintainers for security issues

Thank you for contributing to KickJS! 🚀

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Made with ❤️ by the KickJS team**
