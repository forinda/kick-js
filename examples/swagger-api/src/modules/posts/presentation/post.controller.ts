import { Controller, Get, Post as HttpPost, Put, Delete, Patch, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@forinda/kickjs-swagger'
import { z } from 'zod'
import { CreatePostUseCase } from '../application/use-cases/create-post.use-case'
import { GetPostUseCase } from '../application/use-cases/get-post.use-case'
import { ListPostsUseCase } from '../application/use-cases/list-posts.use-case'
import { UpdatePostUseCase } from '../application/use-cases/update-post.use-case'
import { DeletePostUseCase } from '../application/use-cases/delete-post.use-case'
import { createPostSchema } from '../application/dtos/create-post.dto'
import { updatePostSchema } from '../application/dtos/update-post.dto'
import { postResponseSchema } from '../application/dtos/post-response.dto'

const idParams = z.object({ id: z.string().uuid() })
const slugParams = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) })

// Demonstrates: status transition schema with enum constraint
const publishSchema = z.object({
  publishAt: z.string().datetime().optional(),
})

@Controller()
@ApiTags('Posts')
@ApiBearerAuth()
export class PostController {
  @Autowired() private createPostUseCase!: CreatePostUseCase
  @Autowired() private getPostUseCase!: GetPostUseCase
  @Autowired() private listPostsUseCase!: ListPostsUseCase
  @Autowired() private updatePostUseCase!: UpdatePostUseCase
  @Autowired() private deletePostUseCase!: DeletePostUseCase

  @HttpPost('/', { body: createPostSchema })
  @ApiOperation({
    summary: 'Create a new post',
    description: 'Demonstrates: nested objects (media array), record types (metadata), '
      + 'UUID arrays (relatedPostIds), regex slug validation, ISO datetime, and boolean defaults.',
  })
  @ApiResponse({ status: 201, description: 'Post created', schema: postResponseSchema })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(ctx: RequestContext) {
    const result = await this.createPostUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/')
  @ApiOperation({
    summary: 'List all posts',
    description: 'Returns all posts. Combine with ctx.qs() for filtering/sorting/pagination.',
  })
  @ApiResponse({ status: 200, description: 'List of posts' })
  async list(ctx: RequestContext) {
    const result = await this.listPostsUseCase.execute()
    ctx.json(result)
  }

  @Get('/:id', { params: idParams })
  @ApiOperation({ summary: 'Get post by ID' })
  @ApiResponse({ status: 200, description: 'Post found', schema: postResponseSchema })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getById(ctx: RequestContext) {
    const result = await this.getPostUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Post not found')
    ctx.json(result)
  }

  @Get('/by-slug/:slug', { params: slugParams })
  @ApiOperation({
    summary: 'Get post by slug',
    description: 'Demonstrates: regex-validated path parameter (slug format).',
  })
  @ApiResponse({ status: 200, description: 'Post found', schema: postResponseSchema })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getBySlug(ctx: RequestContext) {
    // In real implementation, look up by slug
    ctx.json({ message: 'Looked up by slug: ' + ctx.params.slug })
  }

  @Put('/:id', { params: idParams, body: updatePostSchema })
  @ApiOperation({
    summary: 'Update a post',
    description: 'Partial update — all fields are optional.',
  })
  @ApiResponse({ status: 200, description: 'Post updated', schema: postResponseSchema })
  @ApiResponse({ status: 404, description: 'Post not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async update(ctx: RequestContext) {
    const result = await this.updatePostUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Patch('/:id/publish', { params: idParams, body: publishSchema })
  @ApiOperation({
    summary: 'Publish a post',
    description: 'Demonstrates: PATCH for state transitions with a small dedicated schema. '
      + 'Optionally schedule publishing with an ISO datetime.',
  })
  @ApiResponse({ status: 200, description: 'Post published', schema: postResponseSchema })
  @ApiResponse({ status: 404, description: 'Post not found' })
  @ApiResponse({ status: 409, description: 'Post is already published' })
  async publish(ctx: RequestContext) {
    ctx.json({ message: 'Published post ' + ctx.params.id })
  }

  @Delete('/:id', { params: idParams })
  @ApiOperation({
    summary: 'Delete a post',
    operationId: 'deletePost',
    deprecated: false,
  })
  @ApiResponse({ status: 204, description: 'Post deleted' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async remove(ctx: RequestContext) {
    await this.deletePostUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
