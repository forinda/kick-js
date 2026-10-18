import { ConfigService, Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { defer, flash, inertia, redirect } from '@forinda/kickjs-inertia'
import { z } from 'zod'

// In memory for the example — swap in your repository.
const posts = [{ id: 1, title: 'Hello from KickJS' }]

export const createPostSchema = z.object({
  title: z.string().trim().min(3, { error: 'Title needs at least 3 characters' }),
})

@Controller()
export class PagesController {
  constructor(private readonly config: ConfigService) {}

  @Get('/')
  home() {
    // Renders src/client/pages/Home.tsx with these props.
    return inertia(
      'Home',
      { greeting: 'Welcome to {{name}}' },
      // In the first HTML response, for search engines and link previews.
      {
        meta: {
          title: 'Home',
          // 120–160 characters reads best in search results.
          description:
            'Welcome to {{name}}: a KickJS and Inertia app with server-rendered pages, typed forms and posts you can browse and add to.',
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: '{{name}}',
            url: this.config.get('APP_URL'),
          },
        },
      },
    )
  }

  @Get('/posts')
  index() {
    return inertia(
      'Posts/Index',
      {
        // Plain props are in the first HTML response — keep what search
        // engines should index here.
        posts,
        // Loaded right after the page renders, in a second request — not
        // in the HTML a crawler reads.
        stats: defer(() => ({ total: posts.length })),
      },
      {
        meta: {
          title: 'Posts',
          description:
            'Every post on {{name}}, newest last. Read what has been written so far, or add a post of your own with the form on this page.',
        },
      },
    )
  }

  // A failed schema check redirects back with props.errors (see
  // inertiaErrorHandler in src/index.ts).
  @Post('/posts', { body: createPostSchema })
  create(ctx: RequestContext) {
    posts.push({ id: posts.length + 1, title: ctx.body.title })
    flash(ctx, { success: 'Post created' })
    return redirect('/posts')
  }
}
