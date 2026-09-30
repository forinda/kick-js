import { Service } from '@forinda/kickjs'

@Service()
export class HelloService {
  greet(name: string) {
    return { message: `Hello ${name} from KickJS!`, timestamp: new Date().toISOString() }
  }

  healthCheck() {
    return { status: 'ok', uptime: process.uptime() }
  }
}
