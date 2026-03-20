import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'otel-api-example',
    [ATTR_SERVICE_VERSION]: '0.5.2',
  }),
  traceExporter: new ConsoleSpanExporter(),
})

sdk.start()

process.on('SIGTERM', () => sdk.shutdown())
