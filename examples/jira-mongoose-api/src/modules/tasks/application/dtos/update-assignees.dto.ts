import { z } from 'zod';

export const updateAssigneesSchema = z.object({
  assigneeIds: z.array(z.string()),
});

export type UpdateAssigneesDto = z.infer<typeof updateAssigneesSchema>;
