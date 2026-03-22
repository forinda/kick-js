import { z } from 'zod';

export const changeStatusSchema = z.object({
  status: z.string().min(1),
});

export type ChangeStatusDto = z.infer<typeof changeStatusSchema>;
