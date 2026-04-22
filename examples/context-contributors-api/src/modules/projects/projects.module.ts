import {
  buildRoutes,
  type AppModule,
  type Container,
  type ContributorRegistration,
  type ModuleRoutes,
} from '@forinda/kickjs'
import { LoadAuditTrail } from '../../contributors'
import { ProjectsController } from './projects.controller'
import { InMemoryProjectsRepo, PROJECTS_REPO } from './projects.repo'

export class ProjectsModule implements AppModule {
  /**
   * Module-level DI bindings: register the in-memory ProjectsRepo so the
   * `LoadProject` contributor's `deps: { repo: PROJECTS_REPO }` resolves.
   */
  register(container: Container): void {
    container.registerInstance(PROJECTS_REPO, new InMemoryProjectsRepo())
  }

  /**
   * Module-level Context Contributors (#107).
   *
   * Returned contributors apply to every route mounted by this module
   * (here: ProjectsController) at the `'module'` precedence level.
   * They lose to method/class decorators on the same key but win over
   * adapter and global contributors.
   */
  contributors(): ContributorRegistration[] {
    return [LoadAuditTrail.registration]
  }

  routes(): ModuleRoutes {
    return {
      path: '/projects',
      router: buildRoutes(ProjectsController),
      controller: ProjectsController,
    }
  }
}
