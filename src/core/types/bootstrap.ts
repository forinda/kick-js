import { Express } from "express";

export type BootstrapContext = {
  modules: any[];
  app: Express;
  middlewares?: any[];
};
