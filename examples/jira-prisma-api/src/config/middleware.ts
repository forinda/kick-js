import express from 'express'
import type { MiddlewareEntry } from '@forinda/kickjs-http'

export const middleware: MiddlewareEntry[] = [
  express.json({ limit: '10mb' }),
  express.urlencoded({ extended: true }),
]
