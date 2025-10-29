import { createModule } from "@forinda/kickjs";
import { TodoController } from "../controllers/todo.controller";

export const todoDomainModule = createModule("todo-domain", {
  controllers: [TodoController],
});