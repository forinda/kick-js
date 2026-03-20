import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

const sqlite = new Database(':memory:')

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

// Seed some data
sqlite.exec(`
  INSERT INTO users (name, email, role, created_at) VALUES
    ('Alice Johnson', 'alice@example.com', 'admin', '2026-01-15T10:00:00.000Z'),
    ('Bob Smith', 'bob@example.com', 'user', '2026-02-01T12:00:00.000Z'),
    ('Charlie Brown', 'charlie@example.com', 'editor', '2026-02-20T08:30:00.000Z'),
    ('Diana Prince', 'diana@example.com', 'user', '2026-03-01T14:00:00.000Z');

  INSERT INTO posts (title, content, published, author_id, created_at) VALUES
    ('Getting Started with KickJS', 'A guide to building APIs...', 1, 1, '2026-01-20T10:00:00.000Z'),
    ('Advanced Decorators', 'Deep dive into decorators...', 1, 1, '2026-02-10T10:00:00.000Z'),
    ('Draft Post', 'Work in progress...', 0, 2, '2026-03-01T10:00:00.000Z'),
    ('Drizzle ORM Tips', 'How to use Drizzle with KickJS...', 1, 3, '2026-03-10T10:00:00.000Z');

  INSERT INTO products (name, description, price, stock, category, created_at) VALUES
    ('Widget A', 'A basic widget', 9.99, 100, 'widgets', '2026-01-01T00:00:00.000Z'),
    ('Widget B', 'A premium widget', 29.99, 50, 'widgets', '2026-01-15T00:00:00.000Z'),
    ('Gadget X', 'An essential gadget', 49.99, 25, 'gadgets', '2026-02-01T00:00:00.000Z'),
    ('Gadget Y', 'A luxury gadget', 99.99, 10, 'gadgets', '2026-02-15T00:00:00.000Z'),
    ('Tool Z', 'A versatile tool', 14.99, 200, 'tools', '2026-03-01T00:00:00.000Z');
`)

export const db = drizzle({ client: sqlite, schema })
export type AppDatabase = typeof db
export { sqlite }
export { schema }
