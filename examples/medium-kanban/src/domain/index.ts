import { createModule } from "@forinda/kickjs";
import { BoardController } from "../controllers/board.controller";

export const kanbanDomainModule = createModule("kanban-domain", {
  controllers: [BoardController],
});