import { createToken } from '@forinda/kickjs'

export interface Project {
  id: string
  tenantId: string
  title: string
}

export interface ProjectsRepo {
  find(tenantId: string, projectId: string): Project | undefined
  list(tenantId: string): Project[]
}

export const PROJECTS_REPO = createToken<ProjectsRepo>('ProjectsRepo')

/** In-memory implementation seeded with two projects for the demo tenant. */
export class InMemoryProjectsRepo implements ProjectsRepo {
  private readonly data: Project[] = [
    { id: 'p-1', tenantId: 'demo-tenant', title: 'Onboarding' },
    { id: 'p-2', tenantId: 'demo-tenant', title: 'Migration' },
  ]

  find(tenantId: string, projectId: string): Project | undefined {
    return this.data.find((p) => p.tenantId === tenantId && p.id === projectId)
  }

  list(tenantId: string): Project[] {
    return this.data.filter((p) => p.tenantId === tenantId)
  }
}
