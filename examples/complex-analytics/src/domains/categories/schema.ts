import z from "zod";

export const categorySchema = z.object({
  id: z.uuid("Invalid UUID format"),
  name: z
    .string()
    .min(1, { message: "Name must be at least 1 character long" })
    .max(100, { message: "Name must be at most 100 characters" }),
  description: z
    .string({ error: "Invalid description" })
    .max(500, { message: "Description must be at most 500 characters" })
    .optional(),
});

export type Category = z.infer<typeof categorySchema>;
