import { z } from "zod";
const schema = z.object({
    url: z.string().url("Invalid URL format")
});
export function validateUrl(body) {
    return schema.parse(body);
}
