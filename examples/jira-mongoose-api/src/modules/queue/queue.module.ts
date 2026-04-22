import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';

// Eagerly load decorated classes so @Job() decorators populate the jobRegistry
import.meta.glob(
  ['./infrastructure/processors/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class QueueModule implements AppModule {
  register(_container: Container): void {
    // No manual registration needed — QueueAdapter v1.2.6+ auto-registers
    // @Job classes in the container before resolving them.
  }

  routes(): ModuleRoutes | null {
    return null;
  }
}
