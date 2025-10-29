import {
  KickController,
  KickDelete,
  KickGet,
  KickInject,
  KickPost,
} from "@forinda/kickjs";
import { TodoService } from "./todo-service";

@KickController("/todos")
export class TodoController {
  constructor(
    @KickInject(TodoService)
    private readonly todos: TodoService
  ) {}
  @KickGet("/", {})
  list() {
    return { todos: this.todos.findAll() };
  }

  @KickPost("/")
  create() {
    return { todo: {} };
  }

  @KickDelete("/:id")
  delete(req: { params: { id: string } }) {
    const deleted = this.todos.delete(req.params.id);
    if (deleted) {
      return { success: true };
    }
    return { success: false };
  }
}
