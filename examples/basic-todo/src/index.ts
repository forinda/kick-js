import { createKickApp, getMiddlewareMetadata } from "../../../src";
import express from "express";
import { todoDomainModule } from "./domain";
import { TestMiddleware } from "./m-ware/test-m-ware";
import { AuthMiddleware } from "./m-ware/auth-middleware";
import { CorsMiddleware } from "./global-middlewares/cors.middleware";

const app = express();

// Add JSON parsing middleware
app.use(express.json());

console.log('🚀 Creating KickApp...');

// Demonstrate getting middleware metadata (from classes, not instances)
console.log('📋 Middleware Metadata:');
console.log('  Logger:', getMiddlewareMetadata(TestMiddleware));
console.log('  Auth:', getMiddlewareMetadata(AuthMiddleware));

// Create global middleware instances (not managed by DI)
const corsMiddleware = new CorsMiddleware();

const server = createKickApp({
    name: "BasicTodoApp",
    prefix: "/api/v1", // Add API prefix
    app,
    globalMiddlewares: [corsMiddleware], // Global middlewares
    modules: [todoDomainModule] // DI-managed middlewares are in the module
});

console.log('✅ KickApp created successfully!');
console.log('📊 Available properties:', Object.keys(server));

// Access the KickApp instance safely
if (server.kickApp) {
    console.log('📱 KickApp instance found!');
    
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
    server.kickApp.setState('environment', 'development');

    // Listen for specific state changes
    server.kickApp.onStateChange('todosCount', (data: { value: any; oldValue: any }) => {
        console.log(`📊 Todos count changed: ${data.oldValue} -> ${data.value}`);
    });
} else {
    console.log('❌ KickApp instance not found - using basic server');
}

server.listen(3003, () => {
    console.log("🎯 Todo app is running on http://localhost:3003");
    
    if (server.kickApp) {
        console.log("📈 Current app state:", server.kickApp.state);
        console.log("📊 App stats:", server.kickApp.getStats());
        
        // Update state to demonstrate reactivity
        server.kickApp.setState('status', 'running');
    }
    
    console.log("🌐 Try these endpoints:");
    console.log("   GET    http://localhost:3003/api/v1/todos");
    console.log("   GET    http://localhost:3003/api/v1/todos/stats");
    console.log("   POST   http://localhost:3003/api/v1/todos (body: {\"title\": \"My task\"})");
    console.log("   PATCH  http://localhost:3003/api/v1/todos/{id}/toggle");
    console.log("   DELETE http://localhost:3003/api/v1/todos/{id}");
    console.log("🔐 For POST/PATCH/DELETE, use: Authorization: Bearer demo-api-key");
});