import { KickInjectable } from "@forinda/kickjs";
import { Category } from "./schema";

@KickInjectable()
export class CategoryService {
  private categories: Category[] = [
    { id: "1", name: "Work" },
    { id: "2", name: "Personal" },
  ];

  findAll(): Category[] {
    return this.categories;
  }

  create(category: Category): Category {
    this.categories.push(category);
    return category;
  }

  delete(id: string): boolean {
    const initialLength = this.categories.length;
    this.categories = this.categories.filter((cat) => cat.id !== id);
    return this.categories.length < initialLength;
  }

  update(id: string, updatedCategory: Category): Category | null {
    const index = this.categories.findIndex((cat) => cat.id === id);
    if (index === -1) return null;
    this.categories[index] = updatedCategory;
    return updatedCategory;
  }
}
