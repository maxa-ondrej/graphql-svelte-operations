import { PluginFunction, Types } from "@graphql-codegen/plugin-helpers";

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
} from "graphql";

export function create_variables(args: readonly GraphQLArgument[]) {
  if (args.length === 0) return "undefined";
  return (
    "{" +
    args
      .map(
        (arg) =>
          `"${arg.name}"${isNullableType(arg.type) ? "?" : ""}: ${get_type(
            arg.type
          )}`
      )
      .join(",") +
    "}"
  );
}

export function create_variables_array(args: readonly GraphQLArgument[]) {
  if (args.length === 0) return "{}";
  return (
    "{" + args.map((arg) => `"${arg.name}": "${arg.type}"`).join(",") + "}"
  );
}

export function get_type(
  gql: GraphQLType | GraphQLInputType | GraphQLOutputType,
  nil = true
) {
  if (nil && isNullableType(gql)) {
    return `Types.Maybe<${get_type(gql, false)}>`;
  }
  if (nil && isNonNullType(gql)) {
    return get_type(assertNonNullType(gql).ofType, false);
  }
  if (isListType(gql)) {
    return get_type(assertListType(gql).ofType) + "[]";
  }
  if (isScalarType(gql)) {
    return `Types.Scalars['${gql}']`;
  }
  return `Types.${gql}`;
}

export type SvelteOperationsPluginConfig = {
  types: string;
};

export const plugin: PluginFunction<SvelteOperationsPluginConfig, string> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: SvelteOperationsPluginConfig
) => {
  const typesPath = config.types;
  let result = `import type * as Types from '${typesPath}';
type Query<R = object | null, V = object> = { R: R; V?: V };
type Mutation<R = object | null, V = object> = { R: R; V?: V };

export function query<Q extends Query>(variables: Q['V'] = undefined) {
return new Promise<Q['R']>((r) => r({} as Q['R']));
}

export function mutation<Q extends Query>(variables: Q['V'] = undefined) {
return new Promise<Q['R']>((r) => r({} as Q['R']));
}
`;
  const queryType = schema.getQueryType();
  if (queryType !== undefined && queryType !== null)
    Object.values(queryType.getFields()).forEach((query) => {
      const name = query.name;
      result += `
export type ${name} = Query<${get_type(query.type)}, ${create_variables(
        query.args
      )}>;
export const ${name}__variables = ${create_variables_array(query.args)};
`;
    });

  const mutationType = schema.getMutationType();
  if (mutationType !== undefined && mutationType !== null)
    Object.values(mutationType.getFields()).forEach((mutation) => {
      const name = mutation.name;
      result += `
export type ${name} = Mutation<${get_type(mutation.type)}, ${create_variables(
        mutation.args
      )}>;
export const ${name}__variables = ${create_variables_array(mutation.args)};
`;
    });

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
/*
function get_imported_types(
  content: string,
  imported: string[],
  types: string
) {
  const imported_types = imported
    .filter((s) => s.startsWith("type "))
    .map((s) => s.slice(4))
    .map((s) => s.trim());
  let has_import = content.match(
    `import\\s+type\\s*{([^}]+)}\\s*from\\s*['"]${escape_regex(types)}['"]`
  );
  if (has_import !== null) {
    imported_types.push(...has_import[1].split(",").map((s) => s.trim()));
  }
  return imported_types;
}
*/
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

function replace_promise(
  type: "query" | "mutation",
  id: string,
  entity: string,
  body: string,
  variables: string
) {
  return `new Promise((r,c) => {
    const variables = O${id}.${entity}__variables;
    const keys = Object.keys(variables);
  I${id}.${type}Store({
    client: ${id}_client,
    query: I${id}.gql\`
      ${type} ${entity}\${keys.length === 0 ? '' : '(' + Object.entries(variables).map(([key, value]) => '$' + key + ': ' + value).join(', ') + ')'} {
        ${entity}\${keys.length === 0 ? '' : '(' + keys.map((key) => key + ': $' + key).join(', ') + ')'} ${body}
      }
  \`,
    variables: ${variables}
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

function script(content: string, promises: Map<string, object>, types: string) {
  let has_import = content.match(
    `import\\s*{([^}]+)}\\s*from\\s*['"]${escape_regex(types)}['"]`
  );
  if (has_import === null) {
    return content;
  }

  const imported = has_import[1].split(",").map((s) => s.trim());
  // const imported_types = get_imported_types(content, imported, types);
  let id;
  do {
    id = makeid(16);
  } while (content.includes(id));

  const imported_operations = imported.filter((s) => !s.startsWith("type"));
  const operations = {
    query: undefined,
    mutation: undefined,
  };
  // TODO: fix Types.* like import
  for (const operation of imported_operations) {
    const parts = operation
      .split(" ")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length > 0) {
      if (parts[1] == "as") {
        operations[parts[0]] = parts[2];
      } else {
        operations[parts[0]] = parts[0];
      }
    }
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
        (_, type, variables) => {
          return (
            name +
            " = " +
            replace_promise(
              "query",
              id,
              type,
              body,
              variables.trim().length > 0 ? variables : "{}"
            )
          );
        }
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
        (_, type, variables) =>
          name +
          " = " +
          replace_promise(
            "mutation",
            id,
            type,
            body,
            variables.trim().length > 0 ? variables : "{}"
          )
      );
    }
  });

  return `
import * as I${id} from '@urql/svelte';
import * as O${id} from '${types}';
const ${id}_client = I${id}.getContextClient();
${content}`;
}

function markup(
  { content, filename }: { content: string; filename?: string },
  types: string
): Processed {
  if (filename === undefined) {
    return {
      code: content,
    };
  }
  // Get script and style from content
  const script_elements = content.match(
    /^([\s\S]*?)<script[^>]*>([\s\S]*?)<\/script>([\s\S]*)$/
  );
  if (script_elements === null) {
    return {
      code: content,
    };
  }

  let new_script = script(script_elements[2], get_promises(content), types);
  const code = content.replace(
    /<script([^>]*)>[\s\S]*<\/script>/g,
    (_, args) => `<script ${args}>
    ${new_script}
    </script>`
  );

  return {
    code,
  };
}

export type SvelteProcessorConfig = {
  types: string;
};

export function graphqlPreprocess({
  types,
}: SvelteProcessorConfig): PreprocessorGroup {
  return {
    markup: (options) => markup(options, types),
  };
}
