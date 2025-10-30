import { createKickConfig } from "@forinda/kickjs";

// Example configuration with TypeScript intellisense and type safety
export default createKickConfig({
  // Application configuration
  app: {
    name: 'My Awesome App',
    port: 3000,
    host: 'localhost',
    prefix: '/api/v1',        // API prefix for all routes
    env: 'development'        // Application environment
  },
  
  // Development mode configuration
  dev: {
    port: 3000,              // Dev server port
    host: 'localhost',       // Dev server host
    entry: 'src/index.ts',   // Entry point for development
    watch: true,             // Enable file watching
    env: {
      NODE_ENV: 'development',
      DEBUG: 'app:*',        // Debug namespaces
      LOG_LEVEL: 'debug'
    }
  },
  
  // Production mode configuration
  start: {
    port: 3000,              // Production server port
    host: '0.0.0.0',         // Production server host (all interfaces)
    entry: 'dist/index.js',  // Compiled entry point
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    }
  },

  // Optional: CLI structure configuration
  structure: {
    domainRoot: 'src/domains',
    domainFolders: ['controllers', 'services', 'domain'],
    defaultDomain: 'app'
  },

  // Optional: Code generation configuration
  generators: {
    controllerRoot: 'src/domains/app/controllers'
  }
});

// Benefits of using createKickConfig:
// ✅ TypeScript intellisense for all config keys
// ✅ Type checking prevents typos and wrong value types
// ✅ Auto-completion in IDEs
// ✅ Consistent structure across projects
// ✅ Runtime validation of configuration values