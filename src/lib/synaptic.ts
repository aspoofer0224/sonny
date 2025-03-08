import { CoreMessage, generateObject, generateText, LanguageModel } from "ai";
import { isString } from "lodash";
import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { printNode, zodToTs } from "zod-to-ts";
import { unlines } from "../utils";
import EventEmitter from "events";

export interface Signature<
  TIn extends Record<string, any>,
  TOut extends Record<string, any>
> {
  instructions: string;
  inputFields: { [T in keyof TIn]: z.ZodType<TIn[T]> };
  outputFields: { [T in keyof TOut]: z.ZodType<TOut[T]> };
}

export interface Tool<TIn extends Record<string, any> = any, TOut = any> {
  description: string;
  parameters: { [T in keyof TIn]: z.ZodType<TIn[T]> };
  fn: (args: TIn) => Promise<TOut>;
}

export interface Module<
  TIn extends Record<string, any>,
  TOut extends Record<string, any>
> {
  forward(lm: LanguageModel, input: TIn): Promise<TOut>;
}

export type Trajectory<TTools extends Record<string, Tool<any, any>>> = {
  thought: string;
  toolName: keyof TTools | "finish";
  toolArgs: Record<string, any>;
  observation: any;
}[];

export class Predict<
  TIn extends Record<string, any>,
  TOut extends Record<string, any>
> implements Module<TIn, TOut>
{
  constructor(public signature: Signature<TIn, TOut>) {}

  async forward(
    lm: LanguageModel,
    input: TIn,
    opts?: {
      demos?: [TIn, TOut][];
      history?: CoreMessage[];
      adapter?: Adapter<TIn, TOut, any>;
    }
  ): Promise<TOut> {
    const adapter = opts?.adapter ?? new ChatAdapter();
    const messages: CoreMessage[] = [
      ...(opts?.history ?? []),
      ...adapter.format(this.signature, opts?.demos ?? [], input),
    ];

    const completion = await adapter.generate(lm, this.signature, messages);

    try {
      return adapter.parse(this.signature, completion);
    } catch (e) {
      const adapter = new JsonAdapter<TIn, TOut>();
      const messages: CoreMessage[] = [
        ...(opts?.history ?? []),
        ...adapter.format(this.signature, opts?.demos ?? [], input),
      ];

      const completion = await adapter.generate(lm, this.signature, messages);

      return adapter.parse(this.signature, completion);
    }
  }
}

export class ReAct<
    TIn extends Record<string, any>,
    TOut extends Record<string, any>,
    TTools extends Record<string, Tool<any, any>>
  >
  extends EventEmitter<{
    thought: [string];
    action: [keyof TTools | "finish", Record<string, any>];
    observation: [keyof TTools | "finish", any];
  }>
  implements Module<TIn, [output: TOut, trajectory: Trajectory<TTools>]>
{
  constructor(public signature: Signature<TIn, TOut>, public tools: TTools) {
    super();
  }

  async think(
    lm: LanguageModel,
    input: TIn,
    trajectory: Trajectory<TTools>,
    opts?: {
      history?: CoreMessage[];
    }
  ): Promise<{
    thought: string;
    toolName: keyof TTools | "finish";
    toolArgs: Record<string, any>;
  }> {
    const inputs = Object.keys(this.signature.inputFields)
      .map((fieldName) => `\`${fieldName}\``)
      .join(", ");
    const outputs = Object.keys(this.signature.outputFields)
      .map((fieldName) => `\`${fieldName}\``)
      .join(", ");
    const tools: Record<string, Tool> = {
      ...this.tools,
      finish: {
        description: `Signals that the final outputs, i.e. ${outputs}, are now available and marks the task as complete.`,
        parameters: {},
        fn: async () => "Completed.",
      },
    };
    const instructions = unlines(
      this.signature.instructions,
      `You will be given ${inputs} and your goal is to finish with ${outputs}.`,
      "",
      "To do this, you will interleave Thought, Tool Name, and Tool Args, and receive a resulting Observation.",
      "",
      "Thought can reason about the current situation, and Tool Name can be the following types:",
      "",
      ...Object.entries(tools).map(
        ([toolName, tool], i) =>
          `(${i + 1}) ${toolName}, whose description is <desc>${
            tool.description
          }</desc>. It takes arguments ${formatSchema(
            z.object(tool.parameters),
            ""
          )} in JSON format.`
      )
    );
    const react = new Predict({
      instructions,
      inputFields: {
        ...this.signature.inputFields,
        trajectory: z.string(),
      },
      outputFields: {
        nextThought: z.string(),
        nextToolName: z.enum([
          Object.keys(tools)[0],
          ...Object.keys(tools).slice(1),
        ]),
        nextToolArgs: z.record(z.any()),
      },
    });

    const {
      nextThought: thought,
      nextToolName: toolName,
      nextToolArgs: toolArgs,
    } = await react.forward(
      lm,
      {
        ...input,
        trajectory: formatTrajectory(trajectory),
      },
      opts
    );

    return { thought, toolName, toolArgs };
  }

  async act<K extends keyof TTools | "finish">(
    toolName: K,
    toolArgs: K extends "finish" ? {} : Parameters<TTools[K]["fn"]>[0]
  ): Promise<ReturnType<TTools[K]["fn"]> | string> {
    if (toolName === "finish") {
      return "Completed.";
    } else {
      try {
        return await this.tools[toolName].fn(toolArgs);
      } catch (e) {
        console.error(e);

        return `Failed to execute: ${String(e)}`;
      }
    }
  }

  async extract(
    lm: LanguageModel,
    trajectory: Trajectory<TTools>,
    input: TIn,
    opts?: {
      history?: CoreMessage[];
    }
  ): Promise<TOut> {
    const module = new Predict({
      instructions: this.signature.instructions,
      inputFields: { ...this.signature.inputFields, trajectory: z.string() },
      outputFields: this.signature.outputFields,
    });

    return await module.forward(
      lm,
      {
        ...input,
        trajectory: formatTrajectory(trajectory),
      },
      opts
    );
  }

  async forward(
    lm: LanguageModel,
    input: TIn,
    opts?: {
      history?: CoreMessage[];
      maxIterations?: number;
    }
  ): Promise<[output: TOut, trajectory: Trajectory<TTools>]> {
    const trajectory: Trajectory<TTools> = [];

    for (let i = 0; i < (opts?.maxIterations ?? Infinity); i++) {
      const { thought, toolName, toolArgs } = await this.think(
        lm,
        input,
        trajectory,
        opts
      );

      this.emit("thought", thought);
      this.emit("action", toolName, toolArgs);

      const observation = await this.act(
        toolName,
        toolArgs as Parameters<TTools[keyof TTools]["fn"]>[0]
      );

      this.emit("observation", toolName, observation);

      trajectory.push({ thought, toolName, toolArgs, observation });

      if (toolName === "finish") {
        break;
      }
    }

    const output = await this.extract(lm, trajectory, input, opts);

    return [output, trajectory];
  }
}

interface Adapter<
  TIn extends Record<string, any>,
  TOut extends Record<string, any>,
  TCompletion
> {
  format(
    signature: Signature<TIn, TOut>,
    demos: [TIn, TOut][],
    input: TIn
  ): CoreMessage[];

  parse(signature: Signature<TIn, TOut>, completion: TCompletion): TOut;

  generate(
    lm: LanguageModel,
    signature: Signature<TIn, TOut>,
    messages: CoreMessage[]
  ): Promise<TCompletion>;
}

class ChatAdapter<
  TIn extends Record<string, any>,
  TOut extends Record<string, any>
> implements Adapter<TIn, TOut, string>
{
  prepareInstructions(signature: Signature<any, any>): string {
    return unlines(
      "Your input fields are:",
      enumerateFields(signature.inputFields),
      "",
      "Your output fields are:",
      enumerateFields(signature.outputFields),
      "",
      "All interactions will be structured in the following way, with the appropriate values filled in.",
      "",
      formatFields(
        Object.fromEntries(
          Object.entries(signature.inputFields).map(([k, v]) => [
            k,
            [v, `{${k}}`],
          ])
        )
      ),
      "",
      formatSignatureFieldsForInstructions(signature.outputFields),
      "",
      formatFields({ completed: [z.string(), ""] }),
      "",
      "In adhering to this structure, your objective is:",
      ...signature.instructions.split("\n").map((line) => "        " + line)
    );
  }

  formatTurn(signature: Signature<TIn, TOut>, values: TIn): string {
    const fieldsWithValues: Record<string, [z.ZodType, any]> =
      Object.fromEntries(
        Object.keys(signature.inputFields).map((fieldName) => [
          fieldName,
          [signature.inputFields[fieldName], values[fieldName]],
        ])
      );

    return unlines(
      formatFields(fieldsWithValues),
      "",
      "Respond with the corresponding output fields, starting with the field " +
        Object.keys(signature.outputFields)
          .map(
            (fieldName) =>
              `\`[[ ## ${fieldName} ## ]]\`${
                signature.outputFields[fieldName] instanceof z.ZodString ||
                (signature.outputFields[fieldName] instanceof z.ZodNullable &&
                  signature.outputFields[fieldName]._def.innerType instanceof
                    z.ZodString)
                  ? ""
                  : ` (must be formatted as a valid TypeScript ${formatSchema(
                      signature.outputFields[fieldName],
                      fieldName
                    )})`
              }`
          )
          .join(", then ") +
        ", and then ending with the marker for `[[ ## completed ## ]]`."
    );
  }

  format(
    signature: Signature<TIn, TOut>,
    demos: [TIn, TOut][],
    input: TIn
  ): CoreMessage[] {
    return [
      {
        role: "system",
        content: this.prepareInstructions(signature),
      },
      ...demos.flatMap<CoreMessage>(([inp, out]) => [
        {
          role: "user",
          content: this.formatTurn(signature, inp),
        },
        {
          role: "assistant",
          content: formatFields(out),
        },
      ]),
      {
        role: "user",
        content: this.formatTurn(signature, input),
      },
    ];
  }

  parse(signature: Signature<TIn, TOut>, completion: string): TOut {
    const fieldHeaderPattern = /^\[\[ ## (\w+) ## \]\]$/;
    const fields: Record<string, string[]> = {};

    for (const line of completion.split("\n")) {
      const match = line.trim().match(fieldHeaderPattern);

      if (match) {
        fields[match[1]] = [];
      } else if (Object.keys(fields).length > 0) {
        fields[Object.keys(fields).at(-1)!].push(line);
      }
    }

    const result = {} as unknown as TOut;

    for (const key of Object.keys(signature.outputFields)) {
      const fieldName = key as keyof TOut;
      result[fieldName] = parseValue(
        signature.outputFields[fieldName],
        fields[key].join("\n")
      );
    }

    return result;
  }

  async generate(
    lm: LanguageModel,
    _signature: Signature<TIn, TOut>,
    messages: CoreMessage[]
  ): Promise<string> {
    // console.log(messages);

    const { text } = await generateText({ model: lm, messages });

    // console.log(text);

    return text;
  }
}

class JsonAdapter<
  TIn extends Record<string, any>,
  TOut extends Record<string, any>
> implements Adapter<TIn, TOut, TOut>
{
  prepareInstructions(signature: Signature<any, any>): string {
    return unlines(
      "Your input fields are:",
      enumerateFields(signature.inputFields),
      "",
      "Your output fields are:",
      enumerateFields(signature.outputFields),
      "",
      "All interactions will be structured in the following way, with the appropriate values filled in.",
      "",
      "Inputs will have the following structure:",
      "",
      formatFields(
        Object.fromEntries(
          Object.entries(signature.inputFields).map(([k, v]) => [
            k,
            [v, `{${k}}`],
          ])
        )
      ),
      "",
      "Outputs will be a JSON object.",
      "",
      "In adhering to this structure, your objective is:",
      ...signature.instructions.split("\n").map((line) => "        " + line)
    );
  }

  formatTurn(signature: Signature<TIn, TOut>, values: TIn): string {
    const fieldsWithValues: Record<string, [z.ZodType, any]> =
      Object.fromEntries(
        Object.keys(signature.inputFields).map((fieldName) => [
          fieldName,
          [signature.inputFields[fieldName], values[fieldName]],
        ])
      );

    return unlines(
      formatFields(fieldsWithValues),
      "",
      "Respond with the corresponding output fields, starting with the field " +
        Object.keys(signature.outputFields)
          .map(
            (fieldName) =>
              `\`[[ ## ${fieldName} ## ]]\`${
                signature.outputFields[fieldName] instanceof z.ZodString ||
                (signature.outputFields[fieldName] instanceof z.ZodNullable &&
                  signature.outputFields[fieldName]._def.innerType instanceof
                    z.ZodString)
                  ? ""
                  : ` (must be formatted as a valid TypeScript ${formatSchema(
                      signature.outputFields[fieldName],
                      fieldName
                    )})`
              }`
          )
          .join(", then ") +
        ", and then ending with the marker for `[[ ## completed ## ]]`."
    );
  }

  format(
    signature: Signature<TIn, TOut>,
    demos: [TIn, TOut][],
    input: TIn
  ): CoreMessage[] {
    return [
      {
        role: "system",
        content: this.prepareInstructions(signature),
      },
      ...demos.flatMap<CoreMessage>(([inp, out]) => [
        {
          role: "user",
          content: this.formatTurn(signature, inp),
        },
        {
          role: "assistant",
          content: formatFields(out),
        },
      ]),
      {
        role: "user",
        content: this.formatTurn(signature, input),
      },
    ];
  }

  parse(_signature: Signature<TIn, TOut>, completion: TOut): TOut {
    return completion;
  }

  async generate(
    lm: LanguageModel,
    signature: Signature<TIn, TOut>,
    messages: CoreMessage[]
  ): Promise<TOut> {
    const result = await generateObject({
      model: lm,
      messages,
      schema: z.object(signature.outputFields) as unknown as z.ZodType<TOut>,
    });

    return result.object;
  }
}

function formatTrajectory(trajectory: Trajectory<any>): string {
  return formatFields(
    Object.fromEntries(
      trajectory.flatMap(({ thought, toolName, toolArgs, observation }, i) => [
        [`thought${i}`, [z.any(), thought]],
        [`toolName${i}`, [z.any(), toolName]],
        [`toolArgs${i}`, [z.any(), toolArgs]],
        [`observation${i}`, [z.any(), observation]],
      ])
    )
  );
}

function formatSchema(schema: z.ZodType<any>, identifier: string): string {
  return printNode(zodToTs(schema, identifier).node).replace(/\n */g, " ");
}

function parseValue<T>(schema: z.ZodType<T>, value: string): T {
  if (schema instanceof z.ZodString) {
    return value.trim() as unknown as T;
  } else if (
    schema instanceof z.ZodNullable &&
    schema._def.innerType instanceof z.ZodString
  ) {
    if (value.trim()) {
      return value.trim() as unknown as T;
    } else {
      return null as unknown as T;
    }
  } else if (
    schema instanceof z.ZodEnum &&
    schema._def.values.every(isString)
  ) {
    return value.trim() as unknown as T;
  } else {
    return schema.parse(
      JSON.parse(
        value
          .trim()
          .replace(/^```json/, "")
          .replace(/```$/, "")
      )
    );
  }
}

function enumerateFields(fields: Record<string, z.ZodType<any>>): string {
  return Object.entries(fields)
    .map(
      ([fieldName, schema], i) =>
        `${i + 1}. \`${fieldName}\` (${formatSchema(schema, fieldName)})` +
        (schema.description ? `: ${schema.description}` : "")
    )
    .join("\n");
}

function formatSignatureFieldsForInstructions(
  fields: Record<string, z.ZodType>
): string {
  return formatFields(
    Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, [v, fieldMetadata(k, v)]])
    )
  );
}

function formatFieldValue(schema: z.ZodType, value: any): string {
  if (isString(value)) {
    return value;
  } else {
    return JSON.stringify(value);
  }
}

function formatFields(
  fieldsWithValues: Record<string, [schema: z.ZodType, value: any]>
): string {
  const output = [];
  for (const [fieldName, [schema, value]] of Object.entries(fieldsWithValues)) {
    const formattedFieldValue = formatFieldValue(schema, value);

    output.push(`[[ ## ${fieldName} ## ]]\n${formattedFieldValue}`);
  }
  return output.join("\n\n").trim();
}

function fieldMetadata(fieldName: string, schema: z.ZodType): string {
  const desc = fieldDescription(schema);

  return (
    `{${fieldName}}` +
    (desc ? `        # note: the value you produce ${desc}` : "")
  );
}

function fieldDescription(schema: z.ZodType): string {
  if (
    schema instanceof z.ZodString ||
    (schema instanceof z.ZodNullable &&
      schema._def.innerType instanceof z.ZodString)
  ) {
    return "";
  } else if (schema instanceof z.ZodBoolean) {
    return "must be true or false";
  } else if (schema instanceof z.ZodNumber) {
    return `must be a single number`;
  } else if (schema instanceof z.ZodEnum) {
    return `must be one of: ${(schema._def.values as string[]).join("; ")}`;
  } else {
    return `must be parseable according to the following JSON schema: ${JSON.stringify(
      zodToJsonSchema(schema)
    )}`;
  }
}
