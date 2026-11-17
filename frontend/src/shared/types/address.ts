import { z } from "zod";

export const addressSchema = z.object({
  name: z.string().nullable(),
  email: z.string(),
});
export type Address = z.infer<typeof addressSchema>;

export function addressLabel(address: Address): string {
  return address.name?.trim() || address.email;
}
