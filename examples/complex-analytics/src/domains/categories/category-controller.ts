import {
  KickController,
  KickDelete,
  KickGet,
  KickInject,
  KickPost,
  KickPut,
} from "@forinda/kickjs";
import { CategoryService } from "./category-service";

@KickController("/categories")
export class CategoryController {
  @KickInject(CategoryService)
  private readonly categoryService: CategoryService;

  @KickGet("/")
  list() {
    return { categories: this.categoryService.findAll() };
  }

  @KickPost("/")
  create(req: { body: { id: string; name: string } }) {
    const category = this.categoryService.create({
      id: req.body.id,
      name: req.body.name,
    });
    return { category };
  }

  @KickDelete("/:id/delete")
  delete(req: { params: { id: string } }) {
    const deleted = this.categoryService.delete(req.params.id);
    return { success: deleted };
  }

  @KickPut("/:id/update")
  update(req: { params: { id: string }; body: { id: string; name: string } }) {
    const updatedCategory = this.categoryService.update(req.params.id, {
      id: req.body.id,
      name: req.body.name,
    });
    if (updatedCategory) {
      return { category: updatedCategory };
    }
    return { category: null };
  }
}
