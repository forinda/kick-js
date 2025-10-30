import z from "zod";

const schema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  completed: z.boolean(),
});

type Todo = z.infer<typeof schema>;
export class TodoService {
  private todos: Todo[] = [
    {
      id: "123e4567-e89b-12d3-a456-426614174000",
      title: "Sample Todo",
      completed: false,
    },
  ];
  findAll() {
    return this.todos;
  }
  update(id: string, data: Partial<Omit<Todo, "id">>) {
    const todo = this.todos.find((t) => t.id === id);
    if (todo) {
      Object.assign(todo, data);
    }
    return todo;
  }
  create(data: Omit<Todo, "id">) {
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      ...data,
    };
    this.todos.push(newTodo);
    return newTodo;
  }
    delete(id: string) {
    const index = this.todos.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.todos.splice(index, 1);
      return true;
    }
    return false;
  }
}
