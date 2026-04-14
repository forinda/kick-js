import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import express from 'express'
import {
  Controller,
  Get,
  Service,
  Autowired,
  AppModule,
  Container,
  ModuleRoutes,
  bootstrap,
  RequestContext,
  buildRoutes,
} from '@forinda/kickjs'
import { InertiaAdapter, defineInertiaConfig } from '@forinda/kickjs-inertia'

// ── Services ────────────────────────────────────────────────────

@Service()
class PageService {
  getHomePage() {
    return {
      title: 'Welcome to KickJS + Inertia',
      features: [
        'Server-driven SPA — no API layer needed',
        'Decorator-based controllers return page components',
        'Partial reloads with defer(), optional(), always(), merge()',
        'Optional SSR with graceful fallback',
      ],
    }
  }

  getAboutPage() {
    return {
      title: 'About This Example',
      description:
        'This example demonstrates @forinda/kickjs-inertia — the Inertia protocol adapter for KickJS. ' +
        'Controllers return page component names and props instead of JSON. ' +
        'The client-side Inertia adapter (React, Vue, or Svelte) renders the matching component.',
      version: '3.0.5',
    }
  }
}

// ── Controllers ─────────────────────────────────────────────────

@Controller()
class HomeController {
  @Autowired()
  private pageService!: PageService

  @Get('/')
  async index(ctx: RequestContext) {
    const data = this.pageService.getHomePage()
    return ctx.inertia.render('Home', data)
  }
}

@Controller('/about')
class AboutController {
  @Autowired()
  private pageService!: PageService

  @Get('/')
  async index(ctx: RequestContext) {
    const data = this.pageService.getAboutPage()
    return ctx.inertia.render('About', data)
  }
}

// ── Module ──────────────────────────────────────────────────────

class PagesModule implements AppModule {
  register(_container: Container): void {}

  routes(): ModuleRoutes[] {
    return [
      { path: '/', router: buildRoutes(HomeController), controller: HomeController },
      { path: '/about', router: buildRoutes(AboutController), controller: AboutController },
    ]
  }
}

// ── Bootstrap ───────────────────────────────────────────────────

const rootView = readFileSync(resolve('src/app.html'), 'utf-8')

const inertiaConfig = defineInertiaConfig({
  rootView,
  share: async (ctx) => ({
    app: { name: 'KickJS Inertia Example' },
  }),
})

bootstrap({
  modules: [PagesModule],
  adapters: [new InertiaAdapter(inertiaConfig)],
  middleware: [express.json()],
})
