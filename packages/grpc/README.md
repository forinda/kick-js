# @forinda/kickjs-grpc

gRPC, gRPC-Web and the Connect protocol for KickJS, served from the same app and port as your HTTP routes. Services are ordinary KickJS classes with DI, context contributors and `HttpException` error mapping.

## Install

```bash
pnpm add @forinda/kickjs-grpc @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf
```

## Quick example

Generate descriptors from your `.proto` with [`buf`](https://buf.build) and `protoc-gen-es`, then:

```ts
import { Autowired, HttpException, bootstrap } from '@forinda/kickjs'
import { GrpcAdapter, GrpcMethod, GrpcService } from '@forinda/kickjs-grpc'
import { UserService, type GetUserRequest } from './gen/user/v1/user_pb'

@GrpcService(UserService)
export class UserRpc {
  @Autowired() private users!: UserRepository

  @GrpcMethod()
  async getUser(req: GetUserRequest) {
    const user = await this.users.findById(req.id)
    if (!user) throw HttpException.notFound(`No user ${req.id}`) // → Code.NotFound
    return { id: user.id, email: user.email }
  }
}

await bootstrap({ modules: [UserModule()], adapters: [GrpcAdapter()] })
```

```bash
curl -X POST http://localhost:3000/user.v1.UserService/GetUser \
  -H 'Content-Type: application/json' -d '{"id":"1"}'
```

Connect and gRPC-Web work over the app's HTTP/1.1 server. Native gRPC needs HTTP/2 in front (Envoy, nginx, a mesh).

## Documentation

[kickjs.app/guide/grpc](https://kickjs.app/guide/grpc): the context object, options, contributors, error mapping, streaming.

## License

MIT
