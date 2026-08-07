import { z } from "zod";

export const findingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  title: z.string(),
  body: z.string(),
  path: z.string(),
  line: z.number().int(),
  codeAnchor: z.string()
});

export const modelResponseSchema = z.object({
  findings: z.array(findingSchema)
});

export const MODEL_OUTPUT_CONTRACT =
  '{"findings": [{"ruleId": string, "severity": "P0" | "P1" | "P2" | "P3", "title": string, "body": string, "path": string, "line": number, "codeAnchor": string}]}';
