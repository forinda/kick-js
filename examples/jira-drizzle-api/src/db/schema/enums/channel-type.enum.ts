import { pgEnum } from 'drizzle-orm/pg-core'

export const channelTypeEnum = pgEnum('channel_type', ['public', 'private', 'direct'])
