import { bootstrapExpressApp } from "@forinda/kickjs";
import express from "express";
import { todoDomainModule } from "./domain";

const app = express();
const server = bootstrapExpressApp({
  app,
  modules: [todoDomainModule],
});

server.listen(3000, () => {
  console.log("Todo app is running on http://localhost:3000");
});