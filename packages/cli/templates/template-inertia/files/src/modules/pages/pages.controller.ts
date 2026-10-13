import { Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { defer, flash, inertia, redirect } from '@forinda/kickjs-inertia'
import { z } from 'zod'

// In memory for the example — swap in your repository.
const posts = [{ id: 1, title: 'Hello from KickJS' }]

export const createPostSchema = z.object({
  title: z.string().trim().min(3, { error: 'Title needs at least 3 characters' }),
})

@Controller()
export class PagesController {
  @Get('/')
  home() {
    // Renders src/client/pages/Home.tsx with these props.
    return inertia('Home', { greeting: 'Welcome to {{name}}' })
  }

  @Get('/posts')
  index() {
    return inertia('Posts/Index', {
      posts,
      // Loaded right after the page renders, in a second request.
      stats: defer(() => ({ total: posts.length })),
    })
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
