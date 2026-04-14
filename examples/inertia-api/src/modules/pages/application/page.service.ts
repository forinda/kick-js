import { Service } from '@forinda/kickjs'

@Service()
export class PageService {
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
        'This example demonstrates @forinda/kickjs-inertia. ' +
        'Controllers return page component names and props instead of JSON.',
      version: '3.0.5',
    }
  }
}
