import { bootstrapExpressApp } from "@forinda/kickjs";
import express from "express";
import { kanbanDomainModule } from "./domain";

const app = express();
const server = bootstrapExpressApp({
  app,
  modules: [kanbanDomainModule],
});

server.listen(3000, () => {
  console.log("Kanban app is running on http://localhost:3000");
});

if (require.main === module) {
  // This ensures the server starts when the file is run directly
}
