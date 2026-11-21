import { z } from 'zod';

export const discoverySchema = z
  .object({
    mac: z
      .string()
      .regex(/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i)
      .transform((mac) => mac.toUpperCase()),
    firmwareVersion: z.string().trim().min(1).max(32),
    model: z.string().trim().min(1).max(64),
    sensorId: z.string().trim().min(1).max(50),
  })
  .strict();

export const sessionBody = z.object({ sessionId: z.string().uuid() }).strict();
export const sessionParams = z.object({ id: z.string().uuid() });
export const approvalSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
    setorId: z.number().int().positive(),
    ativoId: z.number().int().positive(),
    descricao: z.string().trim().max(100).optional(),
  })
  .strict();
export type Discovery = z.infer<typeof discoverySchema>;
export type Approval = z.infer<typeof approvalSchema>;
