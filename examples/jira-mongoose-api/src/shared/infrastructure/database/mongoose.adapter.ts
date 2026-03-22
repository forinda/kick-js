import mongoose from 'mongoose';
import { Logger } from '@forinda/kickjs-core';
import type { AppAdapter, Container } from '@forinda/kickjs-core';
import { TOKENS } from '@/shared/constants/tokens';

const logger = Logger.for('MongooseAdapter');

export class MongooseAdapter implements AppAdapter {
  name = 'MongooseAdapter';

  constructor(private readonly uri: string) {}

  async beforeStart(_app: any, container: Container) {
    logger.info('Connecting to MongoDB...');
    await mongoose.connect(this.uri);
    container.registerInstance(TOKENS.MONGOOSE, mongoose.connection);
    logger.info('MongoDB connected successfully');
  }

  async shutdown() {
    logger.info('Disconnecting from MongoDB...');
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  }
}
