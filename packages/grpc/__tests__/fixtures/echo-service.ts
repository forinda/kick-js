/**
 * A protobuf service descriptor built at runtime, so the test suite doesn't
 * need `buf generate` (and a checked-in codegen output) to exercise the
 * adapter. Shape-equivalent to what `protoc-gen-es` emits for:
 *
 * ```proto
 * syntax = "proto3";
 * package test.v1;
 *
 * message EchoRequest  { string text = 1; }
 * message EchoResponse { string text = 1; }
 *
 * service EchoService {
 *   rpc Echo(EchoRequest) returns (EchoResponse);
 *   rpc EchoStream(EchoRequest) returns (stream EchoResponse);
 * }
 * ```
 */
import { create, createFileRegistry, type DescService } from '@bufbuild/protobuf'
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from '@bufbuild/protobuf/wkt'

const stringField = (name: string, number: number) => ({
  name,
  number,
  jsonName: name,
  label: FieldDescriptorProto_Label.OPTIONAL,
  type: FieldDescriptorProto_Type.STRING,
})

const fileDescriptor = create(FileDescriptorProtoSchema, {
  name: 'test/v1/echo.proto',
  package: 'test.v1',
  syntax: 'proto3',
  messageType: [
    { name: 'EchoRequest', field: [stringField('text', 1)] },
    { name: 'EchoResponse', field: [stringField('text', 1)] },
  ],
  service: [
    {
      name: 'EchoService',
      method: [
        {
          name: 'Echo',
          inputType: '.test.v1.EchoRequest',
          outputType: '.test.v1.EchoResponse',
        },
        {
          name: 'EchoStream',
          inputType: '.test.v1.EchoRequest',
          outputType: '.test.v1.EchoResponse',
          serverStreaming: true,
        },
      ],
    },
  ],
})

const registry = createFileRegistry(fileDescriptor, () => undefined)

/** `test.v1.EchoService` — two RPCs: unary `Echo`, server-streaming `EchoStream`. */
export const EchoService: DescService = registry.getService('test.v1.EchoService')!

if (EchoService === undefined) {
  throw new Error('fixture build failed: test.v1.EchoService not present in registry')
}
