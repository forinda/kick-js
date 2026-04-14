import { Container, type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { HomeController } from './presentation/home.controller'
import { AboutController } from './presentation/about.controller'

import.meta.glob(['./application/**/*.ts', '!./**/*.test.ts'], { eager: true })

export class PagesModule implements AppModule {
  register(_container: Container): void {}

  routes(): ModuleRoutes {
    return {
      path: '/pages',
      router: buildRoutes(HomeController),
      controller: HomeController,
    }
  }
}

export class AboutModule implements AppModule {
  register(_container: Container): void {}

  routes(): ModuleRoutes {
    return {
      path: '/about',
      router: buildRoutes(AboutController),
      controller: AboutController,
    }
  }
}
