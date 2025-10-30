import { createKickAppWithConfig, getMiddlewareMetadata } from "../../../src";
import express from "express";
import { todoDomainModule } from "./domain";
import { TestMiddleware } from "./m-ware/test-m-ware";
import { AuthMiddleware } from "./m-ware/auth-middleware";
import { CorsMiddleware } from "./global-middlewares/cors.middleware";

const app = express();

// Add JSON parsing middleware
app.use(express.json());

console.log('🚀 Creating KickApp with Config...');

// Demonstrate getting middleware metadata (from classes, not instances)
console.log('📋 Middleware Metadata:');
console.log('  Logger:', getMiddlewareMetadata(TestMiddleware));
console.log('  Auth:', getMiddlewareMetadata(AuthMiddleware));

// Create global middleware instances (not managed by DI)
const corsMiddleware = new CorsMiddleware();

async function startApp() {
    const server = await createKickAppWithConfig({
        app,
        globalMiddlewares: [corsMiddleware], // Global middlewares
        modules: [todoDomainModule], // DI-managed middlewares are in the module
        configOverrides: {
            // You can override config values here if needed
            env: process.env.NODE_ENV || 'development'
        }
    });

    console.log('✅ KickApp created successfully!');
    console.log('📊 Available properties:', Object.keys(server));

    // Access the KickApp instance safely
    if (server.kickApp) {
        console.log('📱 KickApp instance found!');
        
        // Demonstrate config access
        console.log('⚙️  App Config:', {
            name: server.kickApp.getConfig('name'),
            port: server.kickApp.getConfig('port'),
            prefix: server.kickApp.getConfig('prefix'),
            environment: server.kickApp.getConfig('env')
        });
        
        // Demonstrate reactive features
        server.kickApp.on('initialized', (stats: any) => {
            console.log('🚀 App initialized with stats:', stats);
        });

        server.kickApp.on('route:registered', (route: any) => {
            console.log(`📍 Route registered: ${route.method} ${route.path}`);
        });

        server.kickApp.on('controller:mapped', (controller: any) => {
            console.log(`🎮 Controller mapped: ${controller.controller} with ${controller.routeCount} routes`);
        });

        server.kickApp.on('state:changed', (change: any) => {
            console.log(`🔄 State changed: ${change.key} = ${change.value}`);
        });

        // Set some initial state
        server.kickApp.setState('appVersion', '1.0.0');
        server.kickApp.setState('environment', server.kickApp.getConfig('env') || 'development');

        // Listen for specific state changes
        server.kickApp.onStateChange('todosCount', (data: { value: any; oldValue: any }) => {
            console.log(`📊 Todos count changed: ${data.oldValue} -> ${data.value}`);
        });
    } else {
        console.log('❌ KickApp instance not found - using basic server');
    }

    // Get port and host from config or environment variables (set by CLI or config)
    const configPort = server.kickApp?.getConfig('port');
    const port = parseInt(process.env.PORT || configPort?.toString() || '3003');
    const host = process.env.HOST || server.kickApp?.getConfig('host') || 'localhost';

    server.listen(port, () => {
        console.log(`🎯 Todo app is running on http://${host}:${port}`);
        
        if (server.kickApp) {
            console.log("📈 Current app state:", server.kickApp.state);
            console.log("📊 App stats:", server.kickApp.getStats());
            console.log("⚙️  Final config check:", {
                configName: server.kickApp.getConfig('name'),
                configPort: server.kickApp.getConfig('port'),
                actualPort: port,
                hasConfig: server.kickApp.hasConfig('port')
            });
            
            // Update state to demonstrate reactivity
            server.kickApp.setState('status', 'running');
        }
        
        console.log("🌐 Try these endpoints:");
        console.log(`   GET    http://${host}:${port}/api/v1/todos`);
        console.log(`   GET    http://${host}:${port}/api/v1/todos/stats`);
        console.log(`   POST   http://${host}:${port}/api/v1/todos (body: {"title": "My task"})`);
        console.log(`   PATCH  http://${host}:${port}/api/v1/todos/{id}/toggle`);
        console.log(`   DELETE http://${host}:${port}/api/v1/todos/{id}`);
        console.log("🔐 For POST/PATCH/DELETE, use: Authorization: Bearer demo-api-key");
    });
}

// Start the application
startApp().catch(console.error);