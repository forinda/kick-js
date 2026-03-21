# MongoDB Integration

KickJS doesn't ship a MongoDB package — instead, you wire it through the existing adapter and DI patterns. This guide shows two approaches: **Mongoose** (ODM with schemas) and the **native MongoDB driver** (direct access).

## Mongoose

### Setup

```bash
pnpm add mongoose
```

### Create a Mongoose Adapter

```ts
// src/adapters/mongoose.adapter.ts
import mongoose from 'mongoose'
import { Logger, type AppAdapter, type Container } from '@forinda/kickjs-core'

const log = Logger.for('MongooseAdapter')

export const MONGOOSE = Symbol('Mongoose')

export interface MongooseAdapterOptions {
  uri: string
  options?: mongoose.ConnectOptions
}

export class MongooseAdapter implements AppAdapter {
  name = 'MongooseAdapter'

  constructor(private opts: MongooseAdapterOptions) {}

  async afterStart(_server: any, container: Container): Promise<void> {
    await mongoose.connect(this.opts.uri, this.opts.options)
    container.registerInstance(MONGOOSE, mongoose)
    log.info(`Connected to MongoDB: ${this.opts.uri}`)
  }

  async shutdown(): Promise<void> {
    await mongoose.disconnect()
    log.info('MongoDB disconnected')
  }
}
```

### Define Models

```ts
// src/modules/users/domain/user.model.ts
import { Schema, model } from 'mongoose'

export interface IUser {
  name: string
  email: string
  role: 'user' | 'admin'
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
  },
  { timestamps: true },
)

export const User = model<IUser>('User', userSchema)
```

### Repository Using Mongoose

```ts
// src/modules/users/infrastructure/mongoose-user.repository.ts
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { ParsedQuery } from '@forinda/kickjs-http'
import { User, type IUser } from '../domain/user.model'

@Repository()
export class MongooseUserRepository {
  async findById(id: string) {
    return User.findById(id).lean()
  }

  async findPaginated(parsed: ParsedQuery) {
    const { offset, limit } = parsed.pagination
    const [data, total] = await Promise.all([
      User.find().skip(offset).limit(limit).lean(),
      User.countDocuments(),
    ])
    return { data, total }
  }

  async create(dto: { name: string; email: string }) {
    return User.create(dto)
  }

  async update(id: string, dto: Partial<IUser>) {
    const doc = await User.findByIdAndUpdate(id, dto, { new: true }).lean()
    if (!doc) throw HttpException.notFound('User not found')
    return doc
  }

  async delete(id: string) {
    const result = await User.findByIdAndDelete(id)
    if (!result) throw HttpException.notFound('User not found')
  }
}
```

### Wire It Up

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs-http'
import { MongooseAdapter } from './adapters/mongoose.adapter'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new MongooseAdapter({
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/myapp',
    }),
  ],
})
```

### Module Registration

```ts
// src/modules/users/index.ts
import type { AppModule } from '@forinda/kickjs-core'
import { UserController } from './presentation/user.controller'
import { USER_REPOSITORY } from './domain/repositories/user.repository'
import { MongooseUserRepository } from './infrastructure/mongoose-user.repository'

export class UserModule implements AppModule {
  register(container: any) {
    container.registerFactory(
      USER_REPOSITORY,
      () => container.resolve(MongooseUserRepository),
    )
  }

  routes() {
    return { prefix: '/users', controllers: [UserController] }
  }
}
```

---

## Native MongoDB Driver

For direct control without an ODM.

### Setup

```bash
pnpm add mongodb
```

### Create a MongoDB Adapter

```ts
// src/adapters/mongodb.adapter.ts
import { MongoClient, type Db } from 'mongodb'
import { Logger, type AppAdapter, type Container } from '@forinda/kickjs-core'

const log = Logger.for('MongoDBAdapter')

export const MONGO_DB = Symbol('MongoDb')
export const MONGO_CLIENT = Symbol('MongoClient')

export interface MongoDBAdapterOptions {
  uri: string
  dbName: string
}

export class MongoDBAdapter implements AppAdapter {
  name = 'MongoDBAdapter'
  private client: MongoClient | null = null

  constructor(private opts: MongoDBAdapterOptions) {}

  async afterStart(_server: any, container: Container): Promise<void> {
    this.client = new MongoClient(this.opts.uri)
    await this.client.connect()

    const db = this.client.db(this.opts.dbName)
    container.registerInstance(MONGO_CLIENT, this.client)
    container.registerInstance(MONGO_DB, db)

    log.info(`Connected to MongoDB: ${this.opts.dbName}`)
  }

  async shutdown(): Promise<void> {
    await this.client?.close()
    log.info('MongoDB disconnected')
  }
}
```

### Repository Using Native Driver

```ts
// src/modules/products/infrastructure/mongo-product.repository.ts
import { Repository, Inject, HttpException } from '@forinda/kickjs-core'
import type { Db, ObjectId } from 'mongodb'
import type { ParsedQuery } from '@forinda/kickjs-http'
import { MONGO_DB } from '../../../adapters/mongodb.adapter'

interface ProductDoc {
  _id?: ObjectId
  name: string
  price: number
  category: string
  createdAt: Date
  updatedAt: Date
}

@Repository()
export class MongoProductRepository {
  private get collection() {
    return this.db.collection<ProductDoc>('products')
  }

  constructor(@Inject(MONGO_DB) private db: Db) {}

  async findById(id: string) {
    const { ObjectId } = await import('mongodb')
    return this.collection.findOne({ _id: new ObjectId(id) })
  }

  async findPaginated(parsed: ParsedQuery) {
    const { offset, limit } = parsed.pagination
    const [data, total] = await Promise.all([
      this.collection.find().skip(offset).limit(limit).toArray(),
      this.collection.countDocuments(),
    ])
    return { data, total }
  }

  async create(dto: { name: string; price: number; category: string }) {
    const now = new Date()
    const result = await this.collection.insertOne({
      ...dto,
      createdAt: now,
      updatedAt: now,
    })
    return this.findById(result.insertedId.toString())
  }

  async update(id: string, dto: Partial<ProductDoc>) {
    const { ObjectId } = await import('mongodb')
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...dto, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) throw HttpException.notFound('Product not found')
    return result
  }

  async delete(id: string) {
    const { ObjectId } = await import('mongodb')
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) })
    if (result.deletedCount === 0) throw HttpException.notFound('Product not found')
  }
}
```

### Wire It Up

```ts
bootstrap({
  modules,
  adapters: [
    new MongoDBAdapter({
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      dbName: 'myapp',
    }),
  ],
})
```

## Which Approach?

| | Mongoose | Native Driver |
|---|---|---|
| **Best for** | Schema validation, middleware hooks, populate | Full control, performance-critical |
| **Schema** | Defined in Mongoose schemas | Defined in TypeScript interfaces |
| **Validation** | Built-in schema validation | Use Zod DTOs (already have them) |
| **Relations** | `.populate()` for references | Manual `$lookup` or app-level joins |
| **Migrations** | Schema-level (auto-sync) | Manual or use `migrate-mongo` |
| **Bundle size** | ~1.5MB | ~500KB |

Both approaches follow the same KickJS pattern: create an adapter, register the connection in DI, implement a repository, and swap it in your module's `register()`.
