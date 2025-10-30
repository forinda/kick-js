import { createModule } from "../../../../src";
import { TodoController } from "../controllers/todo.controller";
import { TestMiddleware } from "../m-ware/test-m-ware";
import { AuthMiddleware } from "../m-ware/auth-middleware";

export const todoDomainModule = createModule("todo-domain", {
  controllers: [TodoController],
  middlewares: [TestMiddleware, AuthMiddleware],
});