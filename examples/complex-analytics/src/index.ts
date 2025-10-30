import { bootstrapExpressApp } from "@forinda/kickjs";
import express from "express";
import { todoDomainModule } from "./domains/todo";
import { categoryDomainModule } from "./domains/categories";
const app = express();
const server = bootstrapExpressApp({
  app,
  modules: [todoDomainModule, categoryDomainModule],
});
server.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
