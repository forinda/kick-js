import {
  KickController,
  KickDelete,
  KickGet,
  KickInject,
  KickPatch,
  KickPost,
} from "@forinda/kickjs";
import { TodoService } from "../services/todo.service";

@KickController("/todos")
export class TodoController {
  constructor(
    @KickInject(TodoService)
    private readonly todos: TodoService
  ) {}

  @KickGet("/")
  list() {
    return { todos: this.todos.list() };
  }

  @KickPost("/")
  create(req: { body: { title: string } }) {
    const todo = this.todos.create(req.body.title);
    return { todo };
  }

  @KickPatch("/:id/toggle")
  toggle(req: { params: { id: string } }) {
    const todo = this.todos.toggle(req.params.id);
    if (!todo) {
      return { updated: false };
    }
    return { todo, updated: true };
  }

  @KickDelete("/:id")
  remove(req: { params: { id: string } }) {
    const deleted = this.todos.remove(req.params.id);
    return { success: deleted };
  }
}
