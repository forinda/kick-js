/**
 * Joi schemas for the Task resource.
 *
 * These schemas are used for:
 *   1. Request validation via joiValidate() middleware
 *   2. OpenAPI spec generation via joiSchemaParser
 *
 * The same schema serves both purposes — no duplication.
 */
import Joi from 'joi'

export const createTaskSchema = Joi.object({
  title: Joi.string().min(1).max(300).required()
    .description('Task title'),

  description: Joi.string().max(5000).optional().allow('')
    .description('Detailed task description'),

  priority: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium')
    .description('Task priority level'),

  status: Joi.string().valid('todo', 'in_progress', 'review', 'done').default('todo')
    .description('Current task status'),

  assigneeEmail: Joi.string().email().optional()
    .description('Email of the assigned user'),

  dueDate: Joi.string().isoDate().optional()
    .description('Due date in ISO 8601 format'),

  estimatedHours: Joi.number().positive().max(1000).optional()
    .description('Estimated hours to complete'),

  tags: Joi.array().items(Joi.string().min(1).max(50)).max(10).optional()
    .description('Tags for categorization'),

  metadata: Joi.object().pattern(Joi.string(), Joi.string()).optional()
    .description('Arbitrary key-value metadata'),
}).label('CreateTask')

export const updateTaskSchema = Joi.object({
  title: Joi.string().min(1).max(300).optional(),
  description: Joi.string().max(5000).optional().allow(''),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  status: Joi.string().valid('todo', 'in_progress', 'review', 'done').optional(),
  assigneeEmail: Joi.string().email().optional().allow(null),
  dueDate: Joi.string().isoDate().optional().allow(null),
  estimatedHours: Joi.number().positive().max(1000).optional().allow(null),
  tags: Joi.array().items(Joi.string().min(1).max(50)).max(10).optional(),
  metadata: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
}).label('UpdateTask')

export const taskResponseSchema = Joi.object({
  id: Joi.string().uuid().required(),
  title: Joi.string().required(),
  description: Joi.string().allow('', null),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').required(),
  status: Joi.string().valid('todo', 'in_progress', 'review', 'done').required(),
  assigneeEmail: Joi.string().email().allow(null),
  dueDate: Joi.string().isoDate().allow(null),
  estimatedHours: Joi.number().allow(null),
  tags: Joi.array().items(Joi.string()),
  metadata: Joi.object().pattern(Joi.string(), Joi.string()),
  createdAt: Joi.string().isoDate().required(),
  updatedAt: Joi.string().isoDate().required(),
}).label('TaskResponse')
