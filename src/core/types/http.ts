import { NextFunction, Request, Response } from "express";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"
  | "PATCH"
  | "TRACE"
  | "CONNECT"
  | "ALL";

export type KickNextFn = NextFunction;

export interface KickRequest extends Request {}
export interface KickResponse extends Response {}
export type KickRequestHandler = (
  req: KickRequest,
  res: KickResponse,
  next: KickNextFn
) => Promise<void> | void;
