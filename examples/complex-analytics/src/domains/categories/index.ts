import { createModule } from "@forinda/kickjs";
import { CategoryController } from "./category-controller";

export const categoryDomainModule = createModule("category-domain", {
  controllers: [CategoryController],
});
