/**
 * Minimal zod → JSON Schema converter — just enough to describe tool inputs to an
 * LLM's function-calling API. Covers the shapes our tool inputs use; unknown types
 * degrade to a permissive {} rather than throwing, so adding a tool never crashes
 * spec rendering. (If we later need full fidelity, swap in `zod-to-json-schema`.)
 */
import type { ZodTypeAny } from "zod";

export type JsonSchema = Record<string, unknown>;

type ZodDef = { typeName?: string; values?: unknown; innerType?: ZodTypeAny; type?: ZodTypeAny };
const defOf = (s: ZodTypeAny): ZodDef => (s as unknown as { _def: ZodDef })._def;
const descOf = (s: ZodTypeAny): string | undefined => (s as unknown as { description?: string }).description;

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = defOf(schema);
  const withDesc = (js: JsonSchema): JsonSchema => {
    const d = descOf(schema);
    return d ? { ...js, description: d } : js;
  };

  switch (def.typeName) {
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        const childName = defOf(child).typeName;
        properties[key] = zodToJsonSchema(child);
        if (childName !== "ZodOptional" && childName !== "ZodDefault") required.push(key);
      }
      const out: JsonSchema = { type: "object", properties, additionalProperties: false };
      if (required.length > 0) out.required = required;
      return withDesc(out);
    }
    case "ZodString":
      return withDesc({ type: "string" });
    case "ZodNumber":
      return withDesc({ type: "number" });
    case "ZodBoolean":
      return withDesc({ type: "boolean" });
    case "ZodEnum":
      return withDesc({ type: "string", enum: Array.isArray(def.values) ? def.values : [] });
    case "ZodArray":
      return withDesc({ type: "array", items: def.type ? zodToJsonSchema(def.type) : {} });
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return def.innerType ? zodToJsonSchema(def.innerType) : {};
    default:
      return {};
  }
}
