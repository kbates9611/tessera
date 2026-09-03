export function validateInput(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new TypeError("Tool input must be an object.");
  validateValue(schema, args, "input");
}

function validateValue(
  rule: Record<string, unknown>,
  value: unknown,
  path: string,
) {
  const expected = rule.type;
  const valid =
    expected === "array"
      ? Array.isArray(value)
      : expected === "object"
        ? Boolean(value) && typeof value === "object" && !Array.isArray(value)
        : expected === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : expected === "boolean"
            ? typeof value === "boolean"
            : expected === "string"
              ? typeof value === "string"
              : true;
  if (!valid) throw new TypeError(`${path} must be ${String(expected)}.`);
  if (Array.isArray(rule.enum) && !rule.enum.includes(value))
    throw new TypeError(`${path} is outside the allowed values.`);
  if (typeof value === "number") {
    if (typeof rule.minimum === "number" && value < rule.minimum)
      throw new TypeError(`${path} must be at least ${rule.minimum}.`);
    if (typeof rule.maximum === "number" && value > rule.maximum)
      throw new TypeError(`${path} must be no more than ${rule.maximum}.`);
  }
  if (typeof value === "string") {
    if (typeof rule.minLength === "number" && value.length < rule.minLength)
      throw new TypeError(
        `${path} must contain at least ${rule.minLength} characters.`,
      );
    if (typeof rule.maxLength === "number" && value.length > rule.maxLength)
      throw new TypeError(
        `${path} must contain no more than ${rule.maxLength} characters.`,
      );
  }
  if (
    typeof value === "string" &&
    typeof rule.pattern === "string" &&
    !new RegExp(rule.pattern).test(value)
  )
    throw new TypeError(`${path} has an invalid format.`);
  if (Array.isArray(value)) {
    if (typeof rule.minItems === "number" && value.length < rule.minItems)
      throw new TypeError(
        `${path} must contain at least ${rule.minItems} items.`,
      );
    if (typeof rule.maxItems === "number" && value.length > rule.maxItems)
      throw new TypeError(
        `${path} must contain no more than ${rule.maxItems} items.`,
      );
  }
  if (Array.isArray(value) && rule.items && typeof rule.items === "object")
    value.forEach((item, index) =>
      validateValue(
        rule.items as Record<string, unknown>,
        item,
        `${path}[${index}]`,
      ),
    );
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties =
      rule.properties && typeof rule.properties === "object"
        ? (rule.properties as Record<string, Record<string, unknown>>)
        : {};
    const required = Array.isArray(rule.required)
      ? rule.required.map(String)
      : [];
    required.forEach((key) => {
      if (
        object[key] === undefined ||
        object[key] === null ||
        object[key] === ""
      )
        throw new TypeError(`${path}.${key} is required.`);
    });
    if (rule.additionalProperties === false) {
      const extra = Object.keys(object).find((key) => !(key in properties));
      if (extra) throw new TypeError(`${path}.${extra} is not allowed.`);
    }
    Object.entries(object).forEach(([key, nested]) => {
      if (properties[key] && nested !== undefined)
        validateValue(properties[key], nested, `${path}.${key}`);
    });
  }
}
