import {
  KickController,
  KickDelete,
  KickGet,
  KickInject,
  KickPatch,
  KickPost,
  KickRequestContext,
} from "@forinda/kickjs";
import { TodoService } from "../services/todo.service";

@KickController("/todos")
export class TodoController {
  constructor(
    @KickInject(TodoService)
    private readonly todos: TodoService
  ) {
    console.log('🎮 TodoController initialized');
  }

  @KickGet("/")
  list(context: KickRequestContext) {
    const todos = this.todos.list();
    const stats = this.todos.getStats();
    
    const result = { 
      todos, 
      stats,
      message: `Found ${todos.length} todos (${stats.completed} completed, ${stats.pending} pending)`,
      requestId: context.meta.requestId
    };

    context.res.json(result);
  }

  @KickGet("/stats")
  stats(context: KickRequestContext) {
    const stats = this.todos.getStats();
    const result = { 
      stats,
      message: `Todo statistics: ${stats.completionRate.toFixed(1)}% completion rate`,
      requestId: context.meta.requestId
    };

    context.res.json(result);
  }

  @KickGet("/info")
  info(context: KickRequestContext) {
    // Access app config through the request context
    // This would typically be injected via DI or accessed through a service
    const result = {
      message: "Todo app information",
      requestId: context.meta.requestId,
      timestamp: new Date().toISOString(),
      // Note: In a real app, you'd inject the app instance or config service
      note: "Config access would typically be done through dependency injection"
    };

    context.res.json(result);
  }

  @KickPost("/")
  create(context: KickRequestContext) {
    const { req, res } = context;
    
    if (!req.body.title || req.body.title.trim() === '') {
      return res.status(400).json({ 
        error: 'Title is required and cannot be empty',
        success: false,
        requestId: context.meta.requestId
      });
    }

    const todo = this.todos.create(req.body.title.trim());
    const stats = this.todos.getStats();
    
    return res.status(201).json({ 
      todo, 
      stats,
      success: true,
      message: `Todo "${todo.title}" created successfully`,
      requestId: context.meta.requestId
    });
  }

  @KickPatch("/:id/toggle")
  toggle(context: KickRequestContext) {
    const { req, res } = context;
    const todo = this.todos.toggle(req.params.id);
    
    if (!todo) {
      return res.status(404).json({ 
        error: 'Todo not found',
        success: false,
        updated: false,
        requestId: context.meta.requestId
      });
    }

    const stats = this.todos.getStats();
    const status = todo.completed ? 'completed' : 'pending';
    
    return res.json({ 
      todo, 
      stats,
      success: true,
      updated: true,
      message: `Todo "${todo.title}" marked as ${status}`,
      requestId: context.meta.requestId
    });
  }

  @KickDelete("/:id")
  remove(context: KickRequestContext) {
    const { req, res } = context;
    const success = this.todos.remove(req.params.id);
    const stats = this.todos.getStats();
    
    const result = { 
      success, 
      stats,
      message: success ? 'Todo removed successfully' : 'Todo not found',
      requestId: context.meta.requestId
    };

    res.status(success ? 200 : 404).json(result);
  }
}
