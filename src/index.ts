import { PluginFunction, Types } from "@graphql-codegen/plugin-helpers";
import { gql, OperationContext } from "@urql/svelte";
import type { AnyVariables, TypedDocumentNode } from "@urql/core";

import {
  GraphQLSchema,
  isNullableType,
  isNonNullType,
  assertNonNullType,
  isListType,
  assertListType,
  isScalarType,
  type GraphQLArgument,
  type GraphQLInputType,
  type GraphQLOutputType,
  GraphQLType,
  print,
  DocumentNode,
  OperationDefinitionNode,
  FieldNode,
  Kind,
} from "graphql";

function create_variables(args: readonly GraphQLArgument[], id: string) {
  if (args.length === 0) return "undefined";
  return (
    "{" +
    args
      .map(
        (arg) =>
          `"${arg.name}"${isNullableType(arg.type) ? "?" : ""}: ${get_type(
            id,
            arg.type
          )}`
      )
      .join(",") +
    "}"
  );
}

function create_variables_array(args: readonly GraphQLArgument[]) {
  if (args.length === 0) return "{}";
  return (
    "{" + args.map((arg) => `"${arg.name}": "${arg.type}"`).join(",") + "}"
  );
}

function get_type(
  id: string,
  gql: GraphQLType | GraphQLInputType | GraphQLOutputType,
  nil = true
) {
  if (nil && isNullableType(gql)) {
    return `${id}Types.Maybe<${get_type(id, gql, false)}>`;
  }
  if (nil && isNonNullType(gql)) {
    return get_type(id, assertNonNullType(gql).ofType, false);
  }
  if (isListType(gql)) {
    return get_type(id, assertListType(gql).ofType) + "[]";
  }
  if (isScalarType(gql)) {
    return `${id}Types.Scalars['${gql}']`;
  }
  return `${id}Types.${gql}`;
}

export type AdditionalOptions = {
  context?: Partial<OperationContext>;
  fields?: string[];
};

export type SvelteOperationsPluginConfig = {
  types: string;
  queries?: boolean;
  mutations?: boolean;
};

export const plugin: PluginFunction<SvelteOperationsPluginConfig, string> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: SvelteOperationsPluginConfig
) => {
  const id = makeid(16);
  const typesPath = config.types;
  let result = `import type * as ${id}Types from '${typesPath}';
import type { AdditionalOptions as ${id}Types_AdditionalOptions } from '@majksa/svelte-operations';
`;
  const queries = schema.getQueryType()?.getFields();
  const mutations = schema.getMutationType()?.getFields();
  if (config.queries === true && queries !== undefined) {
    result += `type ${id}Types_Query<R = object | null, V = object> = { R: R; V?: V };
export function query<Q extends ${id}Types_Query>(variables: Q['V'] = undefined, options: ${id}Types_AdditionalOptions | undefined = undefined) {
  console.log("Unprocessed query", variables, options);
  return new Promise<Q['R']>((_,c) => c(new Error('Operation has not been processed')));
}
`;
    Object.values(queries).forEach((query) => {
      const name = query.name;
      result += `
export type ${name} = ${id}Types_Query<${get_type(
        id,
        query.type
      )}, ${create_variables(query.args, id)}>;
export const ${name}__variables = ${create_variables_array(query.args)};
`;
    });
  }
  if (config.mutations === true && mutations !== undefined) {
    result += `type ${id}Types_Mutation<R = object | null, V = object> = { R: R; V?: V };
export function mutation<M extends ${id}Types_Mutation>(variables: M['V'] = undefined, options: ${id}Types_AdditionalOptions | undefined = undefined) {
  console.log("Unprocessed query", variables, options);
  return new Promise<M['R']>((_, c) => c(new Error('Operation has not been processed!')));
}
`;
    Object.values(mutations).forEach((mutation) => {
      const name = mutation.name;
      result += `
export type ${name} = ${id}Types_Mutation<${get_type(
        id,
        mutation.type
      )}, ${create_variables(mutation.args, id)}>;
export const ${name}__variables = ${create_variables_array(mutation.args)};
`;
    });
  }
  return result;
};

// Svelte Preprocess

import { PreprocessorGroup, Processed } from "svelte/types/compiler/preprocess";
type Token = { data: string; script: boolean };
type TokensQueue = { tokens: string[]; index: number };
type AwaitBlock = {
  promise: string;
  data?: string;
  then: string[];
  catch: boolean;
};

function tokenize(content: string): Token[] {
  let i = content.indexOf("{");
  if (i === -1) return [{ data: content.trim(), script: false }];
  const tokens = new Array<Token>();
  const before = content.slice(0, i).trim();
  if (before.length > 0) tokens.push({ data: before, script: false });
  const start = i;
  let open = 1;
  let text_mode = 0;
  while (open > 0 && i < content.length) {
    i++;
    if (content[i] === '"') {
      if (text_mode === 0) text_mode = 1;
      else if (text_mode === 1) text_mode = 0;
    }
    if (content[i] === "'") {
      if (text_mode === 0) text_mode = 2;
      else if (text_mode === 2) text_mode = 0;
    }
    if (content[i] === "{" && text_mode === 0) open++;
    if (content[i] === "}" && text_mode === 0) open--;
  }
  if (before.trim().length > 0)
    tokens.push({ data: before.trim(), script: false });
  tokens.push({ data: content.slice(start + 1, i).trim(), script: true });
  return [...tokens, ...tokenize(content.slice(i + 1))];
}

function merge_await_blocks(tokens: TokensQueue, root = true): AwaitBlock[] {
  const blocks = [];
  let block = undefined;
  while (tokens.index < tokens.tokens.length) {
    const token = tokens.tokens[tokens.index];
    const parts = token.split(/\s+/);
    switch (parts[0]) {
      case "#await":
        if (block !== undefined) {
          blocks.push(...merge_await_blocks(tokens, false));
          break;
        }
        if (parts.length === 4) {
          const [_, promise, key, data] = parts;
          if (key === "then") {
            block = { promise, data, then: [], catch: false };
          }
          break;
        }
        if (parts.length === 2) {
          const [_, promise] = parts;
          block = { promise, data: undefined, then: [], catch: false };
        }
        break;
      case ":then":
        if (parts.length === 2 && block !== undefined) {
          const [_, data] = parts;
          block.data = data;
        }
        break;
      case ":catch":
        if (block !== undefined) {
          block.catch = true;
        }
        break;
      case "/await":
        blocks.push(block);
        if (!root) return blocks;
        block = undefined;
        break;
      default:
        if (block !== undefined) {
          if (block.data !== undefined && !block.catch) {
            block.then.push(token);
          }
        }
    }
    tokens.index++;
  }
  return blocks;
}

function parse_field_access(token: string, fields: object, i: number) {
  let current = fields;
  let result = "";
  let open = 0;
  let finished = false;
  while (!finished && i < token.length) {
    if (token[i] === "[") {
      open++;
    } else if (token[i] === "]") {
      open--;
    } else if (open > 0 && (token[i] === "'" || token[i] === '"')) {
      i++;
      result += ".";
      while (token[i] !== "'" && token[i] !== '"') {
        result += token[i];
        i++;
      }
    } else if (open === 0) {
      if (token[i] === " ") {
        finished = true;
      } else {
        result += token[i];
      }
    }
    i++;
  }
  result
    .replace("?", "")
    .split(".")
    .slice(1)
    .filter((p) => p.length > 0)
    .forEach((path) => {
      if (current[path] === undefined) {
        current[path] = {};
      }
      current = current[path];
    });
  return i;
}

function parse_each_unpack(
  input: string,
  fields: object,
  aliases: Map<string, object>
) {
  if (!input.startsWith("{")) {
    aliases.set(input, fields);
    return;
  }
  for (let field of input.slice(1, -1).trim().split(",")) {
    field = field.trim();
    if (fields[field] === undefined) {
      fields[field] = {};
    }
    parse_each_unpack(field, fields[field], aliases);
  }
}

function parse_await_block(
  block: AwaitBlock
): [string, Record<string, object>] {
  const { promise, data, then: code } = block;
  const fields = {};
  const aliases = new Map([[data, fields]]);

  for (const token of code) {
    if (token.startsWith("#each")) {
      const [_, key, __, ...value] = token.split(/\s+/);
      let my_fields = {};
      let current_fields = aliases.get(key.split(".", 2)[0].split("[", 2)[0]);
      parse_field_access(key, my_fields, 0);
      for (const [path] of Object.entries(my_fields)) {
        if (current_fields[path] === undefined) {
          current_fields[path] = {};
        }
        current_fields = current_fields[path];
      }
      let new_value = value.join(" ").trim();
      parse_each_unpack(
        new_value.startsWith("{")
          ? new_value
          : new_value.split(",", 2)[0].trim(),
        current_fields,
        aliases
      );
      continue;
    }

    let i = 0;
    while (i >= 0 && i < token.length) {
      const indexes = Array.from(aliases.keys())
        .map((key) => ({ pos: token.indexOf(key, i), key }))
        .filter(({ pos }) => pos !== -1)
        .sort(({ pos: a }, { pos: b }) => a - b)[0];
      if (indexes === undefined) {
        break;
      }

      i = parse_field_access(token, aliases.get(indexes.key), indexes.pos);
    }
  }
  return [promise, fields];
}

function get_promises(code: string) {
  const tokens = tokenize(code.replace(/<script[^>]*>[\s\S]*<\/script>/g, ""));
  const scripts = tokens.filter((t) => t.script).map((t) => t.data);
  const awaits = merge_await_blocks({
    tokens: scripts,
    index: 0,
  });
  return new Map(awaits.map(parse_await_block));
}

function create_gql_body(fields: object) {
  const body = [];
  for (const [name, children] of Object.entries(fields)) {
    if (Object.keys(children).length > 0) {
      body.push(name + " " + create_gql_body(children));
    } else {
      body.push(name);
    }
  }
  return `{ ${body.join(" ")} }`;
}

function escape_regex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeid(length: number) {
  let result = "";
  const characters = "abcdefghijklmnopqrstuvwxyz";
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}

const SOURCE_NAME = "gql";
const GRAPHQL_STRING_RE = /("{3}[\s\S]*"{3}|"(?:\\.|[^"])*")/g;
const REPLACE_CHAR_RE = /(#[^\n\r]+)?(?:\n|\r\n?|$)+/g;
const docs = new Map();
const prints = new Map();
const replaceOutsideStrings = (str: string, idx: number) =>
  idx % 2 === 0 ? str.replace(REPLACE_CHAR_RE, "\n") : str;

const sanitizeDocument = (node: string) =>
  node.split(GRAPHQL_STRING_RE).map(replaceOutsideStrings).join("").trim();

function stringifyDocument(node: DocumentNode): string {
  let printed: string;
  if (typeof node === "string") {
    printed = sanitizeDocument(node);
    // @ts-ignore
  } else if (node.loc && docs.get(node.__key) === node) {
    printed = node.loc.source.body;
  } else {
    printed = prints.get(node) || sanitizeDocument(print(node));
    prints.set(node, printed);
  }
  if (typeof node !== "string" && !node.loc) {
    // @ts-ignore
    node.loc = {
      start: 0,
      end: printed.length,
      source: {
        body: printed,
        name: SOURCE_NAME,
        locationOffset: {
          line: 1,
          column: 1,
        },
      },
    };
  }
  return printed;
}

export function merge_documents(doc: TypedDocumentNode, fields_raw: string[]) {
  if (fields_raw.length === 0) {
    return doc;
  }

  const operation = doc.definitions[0] as OperationDefinitionNode;
  const endpoint = operation.selectionSet.selections[0] as FieldNode;
  const fields = new Array<FieldNode>();
  if (endpoint.selectionSet !== undefined) {
    fields.push(...(endpoint.selectionSet.selections as FieldNode[]));
  }
  for (const field of fields_raw) {
    let current = fields;
    field.split(".").forEach((f) => {
      let found = false;
      for (const key in current) {
        const field = current[key];
        if (field.name.value === f) {
          if (field.selectionSet === undefined) {
            current[key] = {
              ...field,
              selectionSet: {
                kind: Kind.SELECTION_SET,
                selections: [],
              },
            };
          }
          current = current[key].selectionSet.selections as FieldNode[];
          found = true;
          break;
        }
      }
      if (!found) {
        const new_field: FieldNode = {
          kind: Kind.FIELD,
          name: {
            kind: Kind.NAME,
            value: f,
          },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [],
          },
        };
        current.push(new_field);
        current = new_field.selectionSet.selections as FieldNode[];
      }
    });
  }
  const final_doc: TypedDocumentNode<any, AnyVariables> = {
    ...doc,
    definitions: [
      {
        ...operation,
        selectionSet: {
          kind: Kind.SELECTION_SET,
          selections: [
            {
              ...endpoint,
              selectionSet: {
                kind: Kind.SELECTION_SET,
                selections: fields,
              },
            },
          ],
        },
      },
    ],
  };
  return gql(stringifyDocument(final_doc));
}

function replace_promise(
  type: "query" | "mutation",
  id: string,
  entity: string,
  body: string,
  args_raw: string
) {
  const q = gql`
    query Hey {
      stuff
    }
  `;
  q.definitions;
  return `new Promise((r,c) => {
    const args = [${args_raw.replace(/"/g, '\\"')}];
    const variables = ${type === "query" ? "Q" : "M"}${id}.${entity}__variables;
    const keys = Object.keys(variables);
    let query = I${id}.gql\`
    ${type} ${entity}\${keys.length === 0 ? '' : '(' + Object.entries(variables).map(([key, value]) => '$' + key + ': ' + value).join(', ') + ')'} {
      ${entity}\${keys.length === 0 ? '' : '(' + keys.map((key) => key + ': $' + key).join(', ') + ')'} ${body}
    }
\`;
    const new_fields = args[1]?.fields ?? [];
    if (new_fields.length > 0) {
      query = Majksa${id}.merge_documents(query, new_fields);
    }
  I${id}.${type}Store({
    client: ${id}_client,
    query,
    variables: args[0] ?? {},
    context: args[1]?.context
  }).subscribe((result) => {
    if (result.fetching) {
      return;
    }
    if (result.data === undefined || result.error !== undefined) {
      c(result.error ??
        new CombinedError({
          networkError: new Error('Unknown error')
        }));
    } else {
      r(result.data.${entity});
    }
  })
})`;
}

function get_alias(
  type: "query" | "mutation",
  operations: string | undefined,
  content: string
) {
  if (operations === undefined) {
    return undefined;
  }
  let has_operations = content.match(
    `import\\s*{([^}]+)}\\s*from\\s*['"]${escape_regex(operations)}['"]`
  );
  let has_operations_alias = content.match(
    `import\\s*\\*\\s+as\\s+(\w+)\\s*from\\s*['"]${escape_regex(
      operations
    )}['"]`
  );
  if (has_operations === null && has_operations_alias === null) {
    return undefined;
  }
  if (has_operations !== null) {
    const parts = has_operations[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !s.startsWith("type"))
      .map((s) => s.split(/\s+/))
      .filter((s) => s[0] === type)[0];
    return parts[1] == "as" ? parts[2] : type;
  }
  return has_operations_alias[1] + "." + type;
}

function script(
  content: string,
  promises: Map<string, object>,
  queries: string | undefined,
  mutations: string | undefined,
  typescript: boolean
) {
  let id: string;
  do {
    id = makeid(16);
  } while (content.includes(id));

  const operations = {
    query: get_alias("query", queries, content),
    mutation: get_alias("mutation", mutations, content),
  };

  if (operations.query === undefined && operations.mutation === undefined) {
    return content;
  }

  if (!typescript) {
    if (operations.query !== undefined) {
      content = content.replace(
        new RegExp(
          `${escape_regex(operations.query)}\\s*<[^>]+>\\s*\\([^)]*\\)`,
          "g"
        ),
        `new Promise((r,c) => c(new CombinedError({networkError: new Error('TypeScript is required')})))`
      );
    }
    if (operations.mutation !== undefined) {
      content = content.replace(
        new RegExp(
          `${escape_regex(operations.mutation)}\\s*<[^>]+>\\s*\\([^)]*\\)`,
          "g"
        ),
        `new Promise((r,c) => c(new CombinedError({networkError: new Error('TypeScript is required')})))`
      );
    }
    return content;
  }
  promises.forEach((fields, name) => {
    const body = create_gql_body(fields);
    if (operations.query !== undefined) {
      content = content.replace(
        new RegExp(
          `${escape_regex(name)}\\s*=\\s*${escape_regex(
            operations.query
          )}\\s*<([^>]+)>\\s*\\(([^)]*)\\)`,
          "g"
        ),
        (_, type, args_raw) =>
          name + " = " + replace_promise("query", id, type, body, args_raw)
      );
    }
    if (operations.mutation !== undefined) {
      content = content.replace(
        new RegExp(
          `${escape_regex(name)}\\s*=\\s*${escape_regex(
            operations.mutation
          )}\\s*<([^>]+)>\\s*\\(([^)]+)\\)`,
          "g"
        ),
        (_, type, args_raw) =>
          name + " = " + replace_promise("mutation", id, type, body, args_raw)
      );
    }
  });
  if (operations.query !== undefined) {
    content = content.replace(
      new RegExp(
        `${escape_regex(operations.query)}\\s*<([^>]+)>\\s*\\(([^)]*)\\)`,
        "g"
      ),
      (_, type, args_raw) => replace_promise("query", id, type, "", args_raw)
    );
  }
  if (operations.mutation !== undefined) {
    content = content.replace(
      new RegExp(
        `${escape_regex(operations.mutation)}\\s*<([^>]+)>\\s*\\(([^)]+)\\)`,
        "g"
      ),
      (_, type, args_raw) => replace_promise("mutation", id, type, "", args_raw)
    );
  }

  return (
    `import * as I${id} from '@urql/svelte';\n` +
    `import * as Majksa${id} from '@majksa/svelte-operations';\n` +
    (queries !== undefined ? `import * as Q${id} from '${queries}';\n` : "") +
    (mutations !== undefined
      ? `import * as M${id} from '${mutations}';\n`
      : "") +
    `const ${id}_client = I${id}.getContextClient();\n` +
    content
  );
}

function markup(
  { content, filename }: { content: string; filename?: string },
  queries: string | undefined,
  mutations: string | undefined
): Processed {
  if (filename === undefined) {
    return {
      code: content,
    };
  }

  return {
    code: content.replace(
      /<script([^>]*)>([\s\S]*)<\/script>/g,
      (_, args, body) =>
        "<script" +
        args +
        ">\n" +
        script(
          body,
          get_promises(content),
          queries,
          mutations,
          args.match(/lang\s*=\s*["']ts["']/) !== null
        ) +
        "\n</script>"
    ),
  };
}

export type SvelteProcessorConfig = {
  all?: string | undefined;
  queries?: string | undefined;
  mutations?: string | undefined;
};

export function graphqlPreprocess(
  config: SvelteProcessorConfig
): PreprocessorGroup {
  return {
    markup: (options) =>
      markup(
        options,
        config.queries ?? config.all,
        config.mutations ?? config.all
      ),
  };
}
