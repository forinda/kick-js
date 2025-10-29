import { createModule } from "@forinda/kickjs";
import { TodoController } from "./todo-controller";

export const todoDomainModule = createModule("todo-domain", {
  controllers: [TodoController],
});
